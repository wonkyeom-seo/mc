const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  LinuxProcessMetricsReader,
  parseProcessTicks,
  parseRssBytes,
  parseSystemTicks,
} = require('../src/linux-process-metrics');

function processStat(pid, userTicks, systemTicks) {
  const fields = Array(52).fill('0');
  fields[0] = String(pid);
  fields[1] = '(java server)';
  fields[2] = 'S';
  fields[13] = String(userTicks);
  fields[14] = String(systemTicks);
  return fields.join(' ');
}

test('parses Linux procfs process data', () => {
  assert.equal(parseProcessTicks(processStat(42, 120, 30)), 150);
  assert.equal(parseSystemTicks('cpu  100 5 20 800 10 2 3 0 8 0\n'), 940);
  assert.equal(parseRssBytes('Name:\tjava\nVmRSS:\t  204800 kB\n'), 204800 * 1024);
});

test('calculates Java CPU percentage and RSS from a fake procfs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-proc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '42'));
  await fs.writeFile(path.join(root, '42', 'stat'), processStat(42, 100, 50));
  await fs.writeFile(path.join(root, '42', 'status'), 'Name:\tjava\nVmRSS:\t  204800 kB\n');
  await fs.writeFile(path.join(root, 'stat'), 'cpu 100 0 50 850 0 0 0 0 0 0\n');

  const reader = new LinuxProcessMetricsReader({ procRoot: root, cpuCount: 2 });
  const first = await reader.read(42);
  assert.equal(first.cpuPercent, 0);
  assert.equal(first.rssBytes, 204800 * 1024);

  await fs.writeFile(path.join(root, '42', 'stat'), processStat(42, 140, 60));
  await fs.writeFile(path.join(root, 'stat'), 'cpu 150 0 70 880 0 0 0 0 0 0\n');
  const second = await reader.read(42);
  assert.equal(second.cpuPercent, 100);
});
