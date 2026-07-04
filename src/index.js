require('dotenv').config();
const { loadConfig } = require('./config');
const { createApplication } = require('./app');

async function main() {
  const config = loadConfig();
  const { httpServer, manager } = await createApplication(config);

  httpServer.listen(config.port, config.host, () => {
    console.log(`MC Control: http://${config.host}:${config.port}`);
    console.log(`Minecraft 폴더: ${config.serverDir}`);
    console.log(`서버 JAR: ${config.jarPath}`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} 수신, 웹 서버를 종료합니다.`);

    const hardExitTimer = setTimeout(() => process.exit(1), config.stopTimeoutMs + 5_000);
    hardExitTimer.unref();
    httpServer.close();

    if (manager.child) {
      console.log('Minecraft 서버를 안전하게 종료합니다.');
      const stopped = new Promise((resolve) => {
        const onStatus = (status) => {
          if (['stopped', 'crashed'].includes(status.state)) {
            manager.off('status', onStatus);
            resolve();
          }
        };
        manager.on('status', onStatus);
      });
      try {
        if (['starting', 'running'].includes(manager.state)) await manager.stop();
        else if (manager.state !== 'stopping') await manager.forceStop();
        await stopped;
      } catch (error) {
        console.error(`Minecraft 종료 오류: ${error.message}`);
      }
    }

    clearTimeout(hardExitTimer);
    process.exit(0);
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
