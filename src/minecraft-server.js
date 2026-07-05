const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { stripAnsi } = require('../public/ansi');

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

function parsePlayerListLine(message) {
  const clean = stripAnsi(message).replace(/\u00a7[0-9A-FK-OR]/gi, '');
  const match = clean.match(
    /There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online:?\s*(.*)$/i,
  );
  if (!match) return null;
  const players = match[3]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => PLAYER_NAME_PATTERN.test(name));
  return {
    online: players,
    onlineCount: Number(match[1]),
    maxPlayers: Number(match[2]),
  };
}

class MinecraftServerManager extends EventEmitter {
  constructor(config, logStore) {
    super();
    this.config = config;
    this.logStore = logStore;
    this.child = null;
    this.state = 'stopped';
    this.ready = false;
    this.startedAt = null;
    this.sessionId = null;
    this.lastExit = null;
    this.stopTimer = null;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.onlinePlayers = [];
    this.maxPlayers = null;
    this.playersUpdatedAt = null;
  }

  async getStatus() {
    let jarExists = true;
    try {
      await fs.access(this.config.jarPath);
    } catch {
      jarExists = false;
    }

    return {
      state: this.state,
      ready: this.ready,
      pid: this.child?.pid || null,
      startedAt: this.startedAt,
      uptimeSeconds: this.startedAt && this.child
        ? Math.max(0, Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1_000))
        : 0,
      sessionId: this.sessionId,
      lastExit: this.lastExit,
      jarExists,
      serverDirectory: this.config.serverDir,
      jarName: this.config.jarPath.split(/[\\/]/).pop(),
      memory: {
        min: this.config.javaArgs.find((arg) => arg.startsWith('-Xms'))?.slice(4) || null,
        max: this.config.javaArgs.find((arg) => arg.startsWith('-Xmx'))?.slice(4) || null,
      },
    };
  }

  async start() {
    if (this.child || ['starting', 'running', 'stopping'].includes(this.state)) {
      throw this.error('서버가 이미 실행 중이거나 상태를 변경하고 있습니다.', 409);
    }

    try {
      await fs.access(this.config.jarPath);
    } catch {
      throw this.error(`서버 JAR 파일을 찾을 수 없습니다: ${this.config.jarPath}`, 404);
    }

    this.state = 'starting';
    this.ready = false;
    this.startedAt = new Date().toISOString();
    this.sessionId = randomUUID();
    this.lastExit = null;
    this.emitStatus();
    await this.record('system', `서버 시작 요청 — ${this.config.jarPath}`);

    let child;
    try {
      child = spawn(this.config.javaCommand, this.config.javaArgs, {
        cwd: this.config.serverDir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.state = 'crashed';
      this.startedAt = null;
      await this.record('system', `프로세스를 시작하지 못했습니다: ${error.message}`);
      this.emitStatus();
      throw error;
    }

    this.child = child;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.bindChild(child);
    return this.getStatus();
  }

  bindChild(child) {
    child.once('spawn', () => {
      if (this.child !== child) return;
      this.state = 'running';
      this.onlinePlayers = [];
      this.maxPlayers = null;
      this.playersUpdatedAt = null;
      this.emit('process:started', {
        pid: child.pid,
        sessionId: this.sessionId,
      });
      this.emitStatus();
    });

    child.stdout.on('data', (chunk) => this.consume('stdout', chunk));
    child.stderr.on('data', (chunk) => this.consume('stderr', chunk));

    child.once('error', async (error) => {
      if (this.child !== child) return;
      await this.record('system', `서버 프로세스 오류: ${error.message}`);
    });

    child.once('close', async (code, signal) => {
      if (this.child !== child) return;

      this.flushBuffer('stdout');
      this.flushBuffer('stderr');
      clearTimeout(this.stopTimer);
      const wasStopping = this.state === 'stopping';
      this.child = null;
      this.emit('process:stopped', {
        pid: child.pid,
        sessionId: this.sessionId,
      });
      this.ready = false;
      this.onlinePlayers = [];
      this.playersUpdatedAt = new Date().toISOString();
      this.emitPlayers();
      this.lastExit = {
        code,
        signal,
        at: new Date().toISOString(),
        expected: wasStopping,
      };
      this.state = wasStopping || code === 0 ? 'stopped' : 'crashed';
      this.startedAt = null;
      await this.record(
        'system',
        wasStopping
          ? '서버가 정상적으로 종료되었습니다.'
          : `서버 프로세스가 종료되었습니다. (code=${code ?? '-'}, signal=${signal ?? '-'})`,
      );
      this.emitStatus();
    });
  }

  consume(stream, chunk) {
    const bufferKey = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    this[bufferKey] += chunk.toString('utf8');
    const lines = this[bufferKey].split(/\r?\n/);
    this[bufferKey] = lines.pop() || '';
    for (const line of lines) {
      if (line.length > 0) this.handleLine(stream, line);
    }
  }

  flushBuffer(stream) {
    const bufferKey = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    if (this[bufferKey]) {
      this.handleLine(stream, this[bufferKey]);
      this[bufferKey] = '';
    }
  }

  async handleLine(stream, message) {
    this.updatePlayersFromLine(message);
    if (!this.ready && /\bDone \([\d.]+s\)!/.test(message)) {
      this.ready = true;
      this.emitStatus();
    }
    await this.record(stream, message);
  }

  updatePlayersFromLine(message) {
    const list = parsePlayerListLine(message);
    if (list) {
      this.onlinePlayers = list.online;
      this.maxPlayers = list.maxPlayers;
      this.playersUpdatedAt = new Date().toISOString();
      this.emitPlayers();
      return;
    }

    const clean = stripAnsi(message).replace(/\u00a7[0-9A-FK-OR]/gi, '');
    const joined = clean.match(/:\s*([A-Za-z0-9_]{1,16}) joined the game\s*$/i);
    const left = clean.match(/:\s*([A-Za-z0-9_]{1,16}) left the game\s*$/i);
    if (joined && !this.onlinePlayers.includes(joined[1])) {
      this.onlinePlayers.push(joined[1]);
      this.playersUpdatedAt = new Date().toISOString();
      this.emitPlayers();
    } else if (left) {
      this.onlinePlayers = this.onlinePlayers.filter((name) => name !== left[1]);
      this.playersUpdatedAt = new Date().toISOString();
      this.emitPlayers();
    }
  }

  getPlayers() {
    return {
      serverRunning: Boolean(this.child && ['starting', 'running', 'stopping'].includes(this.state)),
      online: [...this.onlinePlayers],
      onlineCount: this.onlinePlayers.length,
      maxPlayers: this.maxPlayers,
      updatedAt: this.playersUpdatedAt,
    };
  }

  async requestPlayerList(timeoutMs = 1_500) {
    if (!this.child || !['starting', 'running'].includes(this.state)) return this.getPlayers();

    const result = new Promise((resolve) => {
      let timer;
      const onPlayers = (players) => {
        clearTimeout(timer);
        this.off('players', onPlayers);
        resolve(players);
      };
      timer = setTimeout(() => {
        this.off('players', onPlayers);
        resolve(this.getPlayers());
      }, timeoutMs);
      timer.unref?.();
      this.on('players', onPlayers);
    });
    this.child.stdin.write('list\n');
    return result;
  }

  async managePlayer(action, playerName, reason = '') {
    const name = String(playerName ?? '').trim();
    if (!PLAYER_NAME_PATTERN.test(name)) {
      throw this.error('플레이어 이름은 영문, 숫자, 밑줄만 사용한 1~16자여야 합니다.', 400);
    }
    const normalizedReason = String(reason ?? '').trim();
    if (normalizedReason.length > 120 || /[\r\n]/.test(normalizedReason)) {
      throw this.error('사유는 한 줄, 120자 이하여야 합니다.', 400);
    }

    const commands = {
      kick: `kick ${name}${normalizedReason ? ` ${normalizedReason}` : ''}`,
      ban: `ban ${name}${normalizedReason ? ` ${normalizedReason}` : ''}`,
      pardon: `pardon ${name}`,
      op: `op ${name}`,
      deop: `deop ${name}`,
      'whitelist-add': `whitelist add ${name}`,
      'whitelist-remove': `whitelist remove ${name}`,
    };
    if (typeof action !== 'string' || !Object.hasOwn(commands, action)) {
      throw this.error('지원하지 않는 플레이어 작업입니다.', 400);
    }
    const command = commands[action];
    await this.sendCommand(command);
    return { ok: true, action, player: name };
  }

  async sendCommand(command) {
    if (!this.child || !['starting', 'running'].includes(this.state)) {
      throw this.error('실행 중인 서버가 없습니다.', 409);
    }

    const normalized = String(command ?? '').trim();
    if (!normalized) throw this.error('명령어를 입력하세요.', 400);
    if (normalized.length > 500 || /[\r\n]/.test(normalized)) {
      throw this.error('명령어는 한 줄, 500자 이하여야 합니다.', 400);
    }

    this.child.stdin.write(`${normalized}\n`);
    await this.record('command', normalized);
  }

  async stop() {
    if (!this.child || !['starting', 'running'].includes(this.state)) {
      throw this.error('실행 중인 서버가 없습니다.', 409);
    }

    this.state = 'stopping';
    this.emitStatus();
    await this.record('system', '서버 종료 요청');
    this.child.stdin.write('stop\n');

    this.stopTimer = setTimeout(() => {
      if (!this.child) return;
      this.record('system', '정상 종료 대기 시간이 초과되어 프로세스를 강제 종료합니다.');
      this.forceStop();
    }, this.config.stopTimeoutMs);
    this.stopTimer.unref?.();

    return this.getStatus();
  }

  async forceStop() {
    if (!this.child) throw this.error('실행 중인 서버가 없습니다.', 409);
    const child = this.child;
    this.state = 'stopping';
    this.emitStatus();
    await this.record('system', '프로세스 강제 종료 요청');

    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => child.kill('SIGKILL'));
    } else {
      child.kill('SIGKILL');
    }
    return this.getStatus();
  }

  async record(stream, message) {
    const entry = await this.logStore.append({
      stream,
      message,
      sessionId: this.sessionId,
    });
    this.emit('console', entry);
    return entry;
  }

  emitStatus() {
    this.getStatus()
      .then((status) => this.emit('status', status))
      .catch((error) => this.emit('managerError', error));
  }

  emitPlayers() {
    this.emit('players', this.getPlayers());
  }

  error(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }
}

module.exports = {
  MinecraftServerManager,
  parsePlayerListLine,
  PLAYER_NAME_PATTERN,
};
