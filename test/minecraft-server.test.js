const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LogStore, formatLocalDate } = require('../src/log-store');
const {
  MinecraftServerManager,
  parsePlayerListLine,
} = require('../src/minecraft-server');

test('parses Paper online player list output', () => {
  assert.deepEqual(
    parsePlayerListLine(
      '[04:00:00 INFO]: There are 2 of a max of 20 players online: Steve, Alex_2',
    ),
    {
      online: ['Steve', 'Alex_2'],
      onlineCount: 2,
      maxPlayers: 20,
    },
  );
});

test('starts a process, streams commands, persists output, and stops cleanly', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-process-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = path.resolve(__dirname, '../fixtures/fake-server.js');
  const logStore = new LogStore(path.join(root, 'data'));
  await logStore.init();
  const manager = new MinecraftServerManager({
    serverDir: root,
    jarPath: fixture,
    javaCommand: process.execPath,
    javaArgs: [fixture],
    stopTimeoutMs: 2_000,
  }, logStore);

  const ready = new Promise((resolve) => {
    manager.on('status', (status) => {
      if (status.ready) resolve(status);
    });
  });

  await manager.start();
  const runningStatus = await ready;
  assert.equal(runningStatus.state, 'running');
  assert.equal(runningStatus.ready, true);

  const players = await manager.requestPlayerList();
  assert.deepEqual(players.online, ['Steve', 'Alex_2']);
  assert.equal(players.maxPlayers, 20);

  const commandOutput = new Promise((resolve) => {
    manager.on('console', (entry) => {
      if (entry.message.includes('Executed command: op Steve')) resolve(entry);
    });
  });
  await manager.managePlayer('op', 'Steve');
  await commandOutput;
  await assert.rejects(
    () => manager.managePlayer('ban', 'bad player\nstop'),
    { statusCode: 400 },
  );

  const stopped = new Promise((resolve) => {
    manager.on('status', (status) => {
      if (status.state === 'stopped') resolve(status);
    });
  });
  await manager.stop();
  await stopped;
  assert.equal(manager.state, 'stopped');

  const history = await logStore.read(formatLocalDate(), 100);
  assert.ok(history.some((entry) => entry.stream === 'command' && entry.message === 'op Steve'));
  assert.ok(history.some((entry) => entry.message.includes('Saving worlds')));
  assert.ok(history.some((entry) => entry.message.includes('정상적으로 종료')));
});
