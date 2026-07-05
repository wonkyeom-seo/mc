const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../src/app');

test('protects management APIs and serves status', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-app-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const serverDir = path.join(root, 'minecraft');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(serverDir);

  const config = {
    appName: 'Test Control',
    adminToken: 'test-secret',
    authRequired: true,
    serverDir,
    jarPath: path.join(serverDir, 'server.jar'),
    javaCommand: 'java',
    javaArgs: ['-Xms1G', '-Xmx2G', '-jar', path.join(serverDir, 'server.jar'), 'nogui'],
    stopTimeoutMs: 100,
    dataDir,
    publicDir: path.resolve(__dirname, '../public'),
  };

  const application = await createApplication(config);
  await new Promise((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    application.io.close();
    application.httpServer.close();
  });
  const address = application.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/status`);
  assert.equal(unauthorized.status, 401);

  const page = await fetch(`${baseUrl}/`);
  const contentSecurityPolicy = page.headers.get('content-security-policy');
  assert.doesNotMatch(contentSecurityPolicy, /upgrade-insecure-requests/);
  assert.equal(page.headers.get('strict-transport-security'), null);

  const authorized = await fetch(`${baseUrl}/api/status`, {
    headers: { Authorization: 'Bearer test-secret' },
  });
  assert.equal(authorized.status, 200);
  const status = await authorized.json();
  assert.equal(status.state, 'stopped');
  assert.equal(status.jarExists, false);

  const metrics = await fetch(`${baseUrl}/api/metrics`, {
    headers: { Authorization: 'Bearer test-secret' },
  });
  assert.equal(metrics.status, 200);
  assert.deepEqual((await metrics.json()).entries, []);
});
