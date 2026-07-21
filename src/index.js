'use strict';

const config = require('./config');
const logger = require('./logger');
const { createApp } = require('./api');
const heartbeat = require('./heartbeat');
const ffmpegManager = require('./ffmpeg');

function main() {
  config.load();
  const cfg = config.get();

  logger.info('========================================');
  logger.info('  Mubasher Core v1.0.0');
  logger.info('  Local IPTV Restream Cache Server');
  logger.info('========================================');
  logger.info(`Port: ${cfg.server.port}`);
  logger.info(`HLS root: ${cfg.stream.hlsRoot}`);
  logger.info(`Log level: ${cfg.log.level}`);

  const app = createApp();

  // Start heartbeat monitoring
  heartbeat.start();

  function shutdown() {
    logger.info('Shutting down...');
    ffmpegManager.stopAll();
    heartbeat.stop();
    logger.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  app.listen(cfg.server.port, cfg.server.host, () => {
    logger.info(`Server listening on http://${cfg.server.host}:${cfg.server.port}`);
    logger.info(`Viewer: http://localhost:${cfg.server.port}/viewer`);
    logger.info(`Admin: http://localhost:${cfg.server.port}/admin`);
    logger.info('Mubasher Core is ready.');
  });
}

main();