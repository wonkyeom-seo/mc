const path = require('node:path');
const { createServer } = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { LogStore, formatLocalDate } = require('./log-store');
const { ServerFileStore } = require('./file-store');
const { MinecraftServerManager } = require('./minecraft-server');

function tokenMatches(actual, expected) {
  if (!expected || typeof actual !== 'string') return !expected;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestToken(req) {
  const authorization = req.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

async function createApplication(config) {
  const logStore = new LogStore(config.dataDir);
  const fileStore = new ServerFileStore(config.serverDir);
  await Promise.all([logStore.init(), fileStore.init()]);

  const manager = new MinecraftServerManager(config, logStore);
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    serveClient: true,
    maxHttpBufferSize: 100_000,
  });

  app.disable('x-powered-by');
  app.use(helmet({
    // 이 앱은 기본적으로 HTTP로 직접 실행됩니다. TLS/HSTS는 리버스 프록시에서
    // 설정해야 하며, HTTP 자산을 HTTPS로 강제 승격하면 CSS/JS가 로드되지 않습니다.
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '2.5mb' }));

  app.get('/api/bootstrap', (req, res) => {
    res.json({
      appName: config.appName,
      authRequired: config.authRequired,
      today: formatLocalDate(),
    });
  });

  app.post('/api/auth/verify', (req, res) => {
    if (!tokenMatches(req.body?.token || '', config.adminToken)) {
      return res.status(401).json({ error: '관리 토큰이 올바르지 않습니다.' });
    }
    return res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (tokenMatches(requestToken(req), config.adminToken)) return next();
    return res.status(401).json({ error: '인증이 필요합니다.' });
  });

  app.get('/api/status', async (req, res, next) => {
    try {
      res.json(await manager.getStatus());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/server/start', async (req, res, next) => {
    try {
      res.status(202).json(await manager.start());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/server/stop', async (req, res, next) => {
    try {
      res.status(202).json(await manager.stop());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/server/force-stop', async (req, res, next) => {
    try {
      res.status(202).json(await manager.forceStop());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/console/command', async (req, res, next) => {
    try {
      await manager.sendCommand(req.body?.command);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/logs/dates', async (req, res, next) => {
    try {
      res.json({ dates: await logStore.listDates(), today: formatLocalDate() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/logs', async (req, res, next) => {
    try {
      const date = String(req.query.date || formatLocalDate());
      const entries = await logStore.read(date, req.query.limit);
      res.json({ date, entries });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/files', async (req, res, next) => {
    try {
      const currentPath = String(req.query.path || '');
      res.json({
        path: currentPath.replaceAll('\\', '/').replace(/^\/+/, ''),
        entries: await fileStore.list(currentPath),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/file', async (req, res, next) => {
    try {
      res.json(await fileStore.read(String(req.query.path || '')));
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/file', async (req, res, next) => {
    try {
      const result = await fileStore.write(
        req.body?.path,
        req.body?.content,
        req.body?.version,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(config.publicDir, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  }));

  app.get('*splat', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) console.error(error);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? '서버 내부 오류가 발생했습니다.' : error.message,
    });
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || '';
    if (tokenMatches(token, config.adminToken)) return next();
    return next(new Error('인증이 필요합니다.'));
  });

  io.on('connection', async (socket) => {
    socket.emit('server:status', await manager.getStatus());
  });
  manager.on('console', (entry) => io.emit('console:entry', entry));
  manager.on('status', (status) => io.emit('server:status', status));
  manager.on('managerError', (error) => console.error(error));

  return {
    app,
    fileStore,
    httpServer,
    io,
    logStore,
    manager,
  };
}

module.exports = {
  createApplication,
  requestToken,
  tokenMatches,
};
