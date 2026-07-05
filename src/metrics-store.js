const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { formatLocalDate } = require('./log-store');

const METRIC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class MetricsStore {
  constructor(dataDir) {
    this.metricsDir = path.join(dataDir, 'metrics');
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.metricsDir, { recursive: true });
  }

  async append(metric) {
    const entry = {
      id: metric.id || randomUUID(),
      timestamp: metric.timestamp || new Date().toISOString(),
      pid: Number(metric.pid),
      cpuPercent: Number(metric.cpuPercent.toFixed(2)),
      cpuCount: Number(metric.cpuCount),
      rssBytes: Number(metric.rssBytes),
      sessionId: metric.sessionId || null,
    };
    const date = formatLocalDate(new Date(entry.timestamp));
    const line = `${JSON.stringify(entry)}\n`;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => fs.appendFile(path.join(this.metricsDir, `${date}.jsonl`), line, 'utf8'));
    await this.writeChain;
    return entry;
  }

  async listDates() {
    await this.init();
    const entries = await fs.readdir(this.metricsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name.slice(0, 10))
      .sort()
      .reverse();
  }

  async read(date = formatLocalDate(), maxPoints = 1_000) {
    if (!METRIC_DATE_PATTERN.test(date)) {
      const error = new Error('올바르지 않은 메트릭 날짜입니다.');
      error.statusCode = 400;
      throw error;
    }
    const safeMaxPoints = Math.min(Math.max(Number(maxPoints) || 1_000, 100), 5_000);
    let text;
    try {
      text = await fs.readFile(path.join(this.metricsDir, `${date}.jsonl`), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const entries = text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (entries.length <= safeMaxPoints) return entries;
    const bucketSize = Math.ceil(entries.length / safeMaxPoints);
    const sampled = [];
    for (let index = 0; index < entries.length; index += bucketSize) {
      const bucket = entries.slice(index, index + bucketSize);
      const peakCpu = bucket.reduce((peak, entry) => (
        entry.cpuPercent > peak.cpuPercent ? entry : peak
      ));
      const peakMemory = bucket.reduce((peak, entry) => (
        entry.rssBytes > peak.rssBytes ? entry : peak
      ));
      const last = bucket[bucket.length - 1];
      sampled.push({
        ...last,
        cpuPercent: peakCpu.cpuPercent,
        rssBytes: peakMemory.rssBytes,
        aggregated: true,
      });
    }
    return sampled;
  }
}

class MetricsCollector extends EventEmitter {
  constructor(store, reader, intervalMs = 5_000) {
    super();
    this.store = store;
    this.reader = reader;
    this.intervalMs = intervalMs;
    this.active = null;
    this.timer = null;
    this.sampling = false;
    this.latest = null;
  }

  start(pid, sessionId) {
    this.stop();
    this.active = { pid, sessionId };
    this.reader.reset();
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.active = null;
    this.reader.reset();
  }

  async sample() {
    if (!this.active || this.sampling) return;
    const target = this.active;
    this.sampling = true;
    try {
      const rawMetric = await this.reader.read(target.pid);
      if (this.active !== target) return;
      const entry = await this.store.append({
        ...rawMetric,
        sessionId: target.sessionId,
      });
      this.latest = entry;
      this.emit('metric', entry);
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) this.emit('collectorError', error);
    } finally {
      this.sampling = false;
    }
  }
}

module.exports = {
  MetricsCollector,
  MetricsStore,
};
