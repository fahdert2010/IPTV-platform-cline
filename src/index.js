'use strict';

const config = require('./config');
const logger = require('./logger');
const runtime = require('./runtime');
const { createApp } = require('./api');
const streamEngine = require('./stream-engine');
const viewerManager = require('./viewer-manager');
const healthSystem = require('./health');
const cache = require('./cache');
const channels = require('./channels');
const sources = require('./sources');

async function main() {
  config.load();
  const cfg = config.get();

  logger.info('═══════════════════════════════════════');
  logger.info('  Mubasher Core v2.0.0');
  logger.info('  Professional IPTV Restream Cache');
  logger.info('═══════════════════════════════════════');
  logger.info(`Port: ${cfg.server.port}`);
  logger.info(`HLS root: ${cfg.stream.hlsRoot}`);
  logger.info(`Log level: ${cfg.log.level}`);
  logger.info(`RAM Cache: ${cfg.cache.ramBufferSizeMb}MB`);
  logger.info(`Disk Cache: ${cfg.cache.diskCacheSizeMb}MB`);
  logger.info(`Idle Stop: ${cfg.stream.idleStopSeconds}s`);

  // ── Load data from storage into RuntimeRegistry ──────────
  await sources.load();
  await channels.load();
  logger.info('Data loaded into RuntimeRegistry.');

  // ── Startup validation: check all enabled channels have source binding ──
  const invalidChannels = runtime.getChannels({ enabled: true })
    .filter(ch => !ch.primarySource && !ch.primaryStreamId && !ch.url);
  if (invalidChannels.length > 0) {
    logger.warn(`Startup: Found ${invalidChannels.length} enabled channel(s) without source binding:`);
    for (const ch of invalidChannels) {
      logger.warn(`  - ${ch.name || ch.id}: no primarySource, no primaryStreamId, no url`);
    }
    logger.warn('These channels will fail with "no valid source URL found" until binding is added.');
  }

  const app = createApp();

  function shutdown(signal) {
    logger.info(`Shutting down (${signal})...`);
    streamEngine.shutdown();
    viewerManager.shutdown();
    healthSystem.shutdown();
    cache.shutdown();
    logger.close();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack?.slice(0, 500) });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason).slice(0, 500) });
  });

  app.listen(cfg.server.port, cfg.server.host, () => {
    logger.info(`Server listening on http://${cfg.server.host}:${cfg.server.port}`);
    logger.info(`Viewer: http://localhost:${cfg.server.port}/viewer`);
    logger.info(`Admin: http://localhost:${cfg.server.port}/admin`);
    logger.info(`API: http://localhost:${cfg.server.port}/api/status`);
    logger.info('═══════════════════════════════════════');
    logger.info('Mubasher Core v2.0 is ready.');
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
