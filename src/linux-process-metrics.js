const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function parseProcessTicks(statText) {
  const commandEnd = statText.lastIndexOf(') ');
  if (commandEnd === -1) throw new Error('올바르지 않은 /proc/<pid>/stat 형식입니다.');
  const fields = statText.slice(commandEnd + 2).trim().split(/\s+/);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) {
    throw new Error('프로세스 CPU 시간을 읽을 수 없습니다.');
  }
  return userTicks + systemTicks;
}

function parseSystemTicks(statText) {
  const cpuLine = statText.split('\n').find((line) => line.startsWith('cpu '));
  if (!cpuLine) throw new Error('시스템 CPU 시간을 읽을 수 없습니다.');
  const fields = cpuLine.trim().split(/\s+/).slice(1, 9).map(Number);
  if (fields.some((value) => !Number.isFinite(value))) {
    throw new Error('올바르지 않은 /proc/stat 형식입니다.');
  }
  return fields.reduce((total, value) => total + value, 0);
}

function parseRssBytes(statusText) {
  const match = statusText.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) return 0;
  return Number(match[1]) * 1024;
}

class LinuxProcessMetricsReader {
  constructor(options = {}) {
    this.procRoot = options.procRoot || '/proc';
    this.cpuCount = options.cpuCount || os.cpus().length || 1;
    this.previous = null;
  }

  async read(pid) {
    const processDir = path.join(this.procRoot, String(pid));
    const [processStat, processStatus, systemStat] = await Promise.all([
      fs.readFile(path.join(processDir, 'stat'), 'utf8'),
      fs.readFile(path.join(processDir, 'status'), 'utf8'),
      fs.readFile(path.join(this.procRoot, 'stat'), 'utf8'),
    ]);

    const processTicks = parseProcessTicks(processStat);
    const systemTicks = parseSystemTicks(systemStat);
    let cpuPercent = 0;

    if (this.previous?.pid === pid) {
      const processDelta = processTicks - this.previous.processTicks;
      const systemDelta = systemTicks - this.previous.systemTicks;
      if (processDelta >= 0 && systemDelta > 0) {
        cpuPercent = (processDelta / systemDelta) * this.cpuCount * 100;
      }
    }

    this.previous = { pid, processTicks, systemTicks };
    return {
      pid,
      cpuPercent: Math.max(0, Math.min(cpuPercent, this.cpuCount * 100)),
      cpuCount: this.cpuCount,
      rssBytes: parseRssBytes(processStatus),
    };
  }

  reset() {
    this.previous = null;
  }
}

module.exports = {
  LinuxProcessMetricsReader,
  parseProcessTicks,
  parseRssBytes,
  parseSystemTicks,
};
