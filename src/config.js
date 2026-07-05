const path = require('node:path');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function integerAtLeast(value, fallback, minimum) {
  return Math.max(positiveInteger(value, fallback), minimum);
}

function parseJsonArray(value, fallback = [], variableName = 'MC_EXTRA_JAVA_ARGS') {
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new TypeError('문자열 배열이 아닙니다.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`${variableName}는 JSON 문자열 배열이어야 합니다: ${error.message}`);
  }
}

function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host);
}

function loadConfig(env = process.env) {
  const projectRoot = path.resolve(__dirname, '..');
  const serverDir = path.resolve(projectRoot, env.MC_SERVER_DIR || 'minecraft');
  const jarSetting = env.MC_SERVER_JAR || 'server.jar';
  const jarPath = path.isAbsolute(jarSetting)
    ? path.resolve(jarSetting)
    : path.resolve(serverDir, jarSetting);
  const host = env.HOST || '127.0.0.1';
  const adminToken = (env.ADMIN_TOKEN || '').trim();
  const serverArgs = parseJsonArray(
    env.MC_SERVER_ARGS,
    ['--nogui', '--nojline'],
    'MC_SERVER_ARGS',
  );

  if (!isLoopbackHost(host) && !adminToken) {
    throw new Error('LAN에 공개하려면 ADMIN_TOKEN을 반드시 설정해야 합니다.');
  }

  return {
    appName: 'MC Control',
    projectRoot,
    host,
    port: positiveInteger(env.PORT, 3000),
    adminToken,
    authRequired: Boolean(adminToken),
    serverDir,
    jarPath,
    javaCommand: env.MC_JAVA_COMMAND || 'java',
    javaArgs: [
      `-Xms${env.MC_MEMORY_MIN || '1G'}`,
      `-Xmx${env.MC_MEMORY_MAX || '2G'}`,
      ...parseJsonArray(env.MC_EXTRA_JAVA_ARGS),
      '-jar',
      jarPath,
      ...serverArgs,
    ],
    stopTimeoutMs: positiveInteger(env.MC_STOP_TIMEOUT_MS, 30_000),
    metricsIntervalMs: integerAtLeast(env.METRICS_INTERVAL_MS, 5_000, 1_000),
    dataDir: path.join(projectRoot, 'data'),
    publicDir: path.join(projectRoot, 'public'),
  };
}

module.exports = {
  isLoopbackHost,
  loadConfig,
  parseJsonArray,
};
