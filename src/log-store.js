const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_READ_BYTES = 8 * 1024 * 1024;

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class LogStore {
  constructor(dataDir) {
    this.logDir = path.join(dataDir, 'console');
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  async append(entry) {
    const normalized = {
      id: entry.id || randomUUID(),
      timestamp: entry.timestamp || new Date().toISOString(),
      stream: entry.stream || 'system',
      message: String(entry.message ?? ''),
      sessionId: entry.sessionId || null,
    };
    const date = formatLocalDate(new Date(normalized.timestamp));
    const line = `${JSON.stringify(normalized)}\n`;

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => fs.appendFile(path.join(this.logDir, `${date}.jsonl`), line, 'utf8'));
    await this.writeChain;
    return normalized;
  }

  async listDates() {
    await this.init();
    const entries = await fs.readdir(this.logDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name.slice(0, 10))
      .sort()
      .reverse();
  }

  async read(date = formatLocalDate(), limit = 500) {
    if (!LOG_DATE_PATTERN.test(date)) {
      const error = new Error('올바르지 않은 로그 날짜입니다.');
      error.statusCode = 400;
      throw error;
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2_000);
    const filePath = path.join(this.logDir, `${date}.jsonl`);

    let handle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    let text;
    try {
      const stat = await handle.stat();
      const bytesToRead = Math.min(stat.size, MAX_HISTORY_READ_BYTES);
      const start = Math.max(0, stat.size - bytesToRead);
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, start);
      text = buffer.toString('utf8');
      if (start > 0) {
        const firstNewline = text.indexOf('\n');
        text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
      }
    } finally {
      await handle.close();
    }

    return text
      .split('\n')
      .filter(Boolean)
      .slice(-safeLimit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

module.exports = {
  formatLocalDate,
  LogStore,
};
