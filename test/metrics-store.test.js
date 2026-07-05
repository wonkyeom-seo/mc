const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { formatLocalDate } = require('../src/log-store');
const { MetricsCollector, MetricsStore } = require('../src/metrics-store');

test('persists and downsamples process metrics', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-metrics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new MetricsStore(root);
  await store.init();

  for (let index = 0; index < 120; index += 1) {
    await store.append({
      timestamp: new Date(Date.now() + index * 5_000).toISOString(),
      pid: 42,
      cpuPercent: index,
      cpuCount: 4,
      rssBytes: (index + 1) * 1024,
      sessionId: 'session',
    });
  }

  const entries = await store.read(formatLocalDate(), 100);
  assert.ok(entries.length <= 100);
  assert.ok(entries.some((entry) => entry.aggregated));
  assert.deepEqual(await store.listDates(), [formatLocalDate()]);
});

test('collector stores and emits reader samples', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-collector-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new MetricsStore(root);
  await store.init();
  const reader = {
    reset() {},
    async read(pid) {
      return { pid, cpuPercent: 12.5, cpuCount: 4, rssBytes: 256 * 1024 * 1024 };
    },
  };
  const collector = new MetricsCollector(store, reader, 20);
  t.after(() => collector.stop());

  const metricPromise = once(collector, 'metric');
  collector.start(77, 'session-77');
  const [metric] = await metricPromise;
  assert.equal(metric.pid, 77);
  assert.equal(metric.cpuPercent, 12.5);
  assert.equal(metric.sessionId, 'session-77');
});
