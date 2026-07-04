const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ServerFileStore } = require('../src/file-store');

test('lists, reads, and safely updates server text files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'server.properties'), 'motd=Hello\n');
  await fs.mkdir(path.join(root, 'plugins'));

  const store = new ServerFileStore(root);
  const entries = await store.list('');
  assert.deepEqual(entries.map((entry) => entry.name), ['plugins', 'server.properties']);

  const file = await store.read('server.properties');
  assert.equal(file.content, 'motd=Hello\n');
  const result = await store.write('server.properties', 'motd=Updated\n', file.version);
  assert.equal((await store.read('server.properties')).content, 'motd=Updated\n');
  assert.notEqual(result.version, file.version);
});

test('blocks traversal and stale writes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-safe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'ops.json'), '[]');
  const store = new ServerFileStore(root);

  await assert.rejects(() => store.read('../outside.txt'), { statusCode: 403 });
  await assert.rejects(() => store.write('ops.json', '["player"]', 'stale'), { statusCode: 409 });
});
