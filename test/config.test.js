const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseJsonArray } = require('../src/config');

test('parseJsonArray accepts only a string array', () => {
  assert.deepEqual(parseJsonArray('["-XX:+UseG1GC","-Dfile.encoding=UTF-8"]'), [
    '-XX:+UseG1GC',
    '-Dfile.encoding=UTF-8',
  ]);
  assert.throws(() => parseJsonArray('["ok", 3]'), /문자열 배열/);
});

test('non-loopback binding requires an admin token', () => {
  assert.throws(
    () => loadConfig({ HOST: '0.0.0.0', ADMIN_TOKEN: '' }),
    /ADMIN_TOKEN/,
  );

  const config = loadConfig({
    HOST: '0.0.0.0',
    ADMIN_TOKEN: 'secret',
    MC_EXTRA_JAVA_ARGS: '[]',
  });
  assert.equal(config.authRequired, true);
});
