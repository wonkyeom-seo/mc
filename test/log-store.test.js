const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LogStore, formatLocalDate } = require('../src/log-store');

test('persists console entries and returns recent history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LogStore(root);
  await store.init();

  await store.append({ stream: 'stdout', message: 'first' });
  await store.append({ stream: 'command', message: 'list' });
  const entries = await store.read(formatLocalDate(), 1);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'list');
  assert.deepEqual(await store.listDates(), [formatLocalDate()]);
});
