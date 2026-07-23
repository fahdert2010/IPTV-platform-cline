'use strict';

const express = require('express');
const router = express.Router();
const runtime = require('../runtime');
const sources = require('../sources');
const streamEngine = require('../stream-engine');
const viewerManager = require('../viewer-manager');
const healthSystem = require('../health');
const logger = require('../logger');
const config = require('../config');

/**
 * GET /api/public/settings
 * Returns settings from config (not hardcoded)
 */
router.get('/settings', (req, res) => {
  try {
    const cfg = config.get();
    res.json({
      settings: {
        siteName: cfg.site?.name || 'Mubasher Core',
        logo: cfg.site?.logo || '',
        phone: cfg.site?.phone || '',
        ticker: cfg.site?.ticker || '',
        cpuSaverDefault: cfg.player?.cpuSaverDefault !== false,
        playerMaxBufferLength: cfg.player?.maxBufferLength || 20,
        playerBackBufferLength: cfg.player?.backBufferLength || 10,
        playerLiveSyncDuration: cfg.player?.liveSyncDuration || 4,
        capLevelToPlayerSize: cfg.player?.capLevelToPlayerSize !== false,
        allowCopyUrl: cfg.admin?.allowCopyUrl !== false,
        allowExternalPlayers: cfg.admin?.allowExternalPlayers !== false,
        allowVlc: cfg.admin?.allowVlc !== false,
        allowPiP: cfg.admin?.allowPiP !== false,
        allowFullscreen: cfg.admin?.allowFullscreen !== false
      }
    });
  } catch (err) {
    logger.error('Public settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/public/channels
 * Returns all enabled channels with real-time state and resolved URL
 */
router.get('/channels', (req, res) => {
  try {
    const channelsList = runtime.getChannels({ enabled: true });

    // Enrich each channel with resolved URL and real-time state
    const enriched = channelsList.map(ch => {
      // Resolve the stream URL from Source
      let resolvedUrl = null;
      if (ch.primarySource && ch.primaryStreamId) {
        resolvedUrl = sources.resolveStreamUrl(ch.primarySource, ch.primaryStreamId);
      }

      // Get real-time stream state
      const stream = runtime.getStream(ch.id);
      const health = runtime.getHealth(ch.id);

      return {
        id: ch.id,
        name: ch.name,
        number: ch.number,
        group: ch.group,
        category: ch.group,      // alias for viewer.js compatibility
        logo: ch.logo,
        tvgLogo: ch.logo,        // alias for viewer.js compatibility
        cover: ch.logo,          // alias for viewer.js compatibility
        language: ch.language,
        country: ch.country,
        enabled: ch.enabled,
        adult: ch.adult,
        primarySource: ch.primarySource,
        primaryStreamId: ch.primaryStreamId,
        resolvedUrl,             // The actual URL to stream from
        state: stream ? stream.state : 'STOPPED',
        viewerCount: stream ? stream.viewers : 0,
        healthScore: health ? health.score : null,
        bitrate: health ? health.bitrate : 0,
        resolution: health ? health.resolution : '',
        fps: health ? health.fps : null,
        codec: health ? health.codec : ''
      };
    });

    res.json({ channels: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Public channels error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/public/channel/:id
 * Returns single channel with full details
 */
router.get('/channel/:id', (req, res) => {
  try {
    const ch = runtime.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    if (!ch.enabled) return res.status(403).json({ error: 'Channel is disabled' });

    let resolvedUrl = null;
    if (ch.primarySource && ch.primaryStreamId) {
      resolvedUrl = sources.resolveStreamUrl(ch.primarySource, ch.primaryStreamId);
    }

    const stream = runtime.getStream(ch.id);
    const health = runtime.getHealth(ch.id);

    res.json({
      channel: {
        ...ch,
        resolvedUrl,
        state: stream ? stream.state : 'STOPPED',
        stream: stream || null,
        health: health || null
      }
    });
  } catch (err) {
    logger.error('Public channel detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/public/channel-health?id=
 */
router.get('/channel-health', (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Channel ID required' });
    const ch = runtime.getChannel(id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });

    const stream = runtime.getStream(id);
    const health = runtime.getHealth(id);

    res.json({
      id: ch.id,
      name: ch.name,
      state: stream ? stream.state : 'STOPPED',
      viewerCount: stream ? stream.viewers : 0,
      healthScore: health ? health.score : null,
      isOnline: stream ? stream.state === 'ONLINE' : false,
      codec: health ? health.codec : null,
      resolution: health ? health.resolution : null,
      fps: health ? health.fps : null,
      bitrate: health ? health.bitrate : 0,
      latency: health ? health.latency : 0
    });
  } catch (err) {
    logger.error('Public channel health error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/public/heartbeat
 */
router.post('/heartbeat', (req, res) => {
  try {
    const { channelId, clientId, stats } = req.body;
    if (!channelId || !clientId) {
      return res.status(400).json({ error: 'channelId and clientId required' });
    }

    // Register/update viewer in ViewerManager
    viewerManager.register(clientId, channelId, {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'] || ''
    });

    viewerManager.heartbeat(clientId, channelId, stats || {});

    // Update stream engine heartbeat
    streamEngine.heartbeat(channelId, clientId, stats);

    const stream = runtime.getStream(channelId);
    res.json({ ok: true, viewers: stream ? stream.viewers : 0 });
  } catch (err) {
    logger.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/public/stream-action/:channelId/start
 * Called by the viewer to start a stream (Lazy Startup).
 */
router.post('/stream-action/:channelId/start', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { viewerId } = req.body;

    const ch = runtime.getChannel(channelId);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    if (!ch.enabled) return res.status(403).json({ error: 'Channel is disabled' });

    const vid = viewerId || 'viewer_' + Math.random().toString(36).slice(2, 10);

    // Register viewer
    viewerManager.register(vid, channelId, {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'] || ''
    });

    // Start stream via stream engine
    await streamEngine.addViewer(channelId, ch, vid, {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'] || ''
    });

    logger.info(`Public: started stream ${channelId} for viewer ${vid}`);
    res.json({ ok: true, channelId, viewerId: vid, message: 'Stream starting' });
  } catch (err) {
    logger.error('Stream start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/public/stream-action/:channelId/stop
 */
router.post('/stream-action/:channelId/stop', (req, res) => {
  try {
    const { channelId } = req.params;
    const { viewerId } = req.body;

    if (viewerId) {
      streamEngine.removeViewer(channelId, viewerId);
      viewerManager.disconnect(viewerId);
    }

    res.json({ ok: true, channelId, message: 'Viewer removed' });
  } catch (err) {
    logger.error('Stream stop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/public/viewers?channelId=
 */
router.get('/viewers', (req, res) => {
  try {
    const { channelId } = req.query;
    if (channelId) {
      const stream = runtime.getStream(channelId);
      return res.json({ channelId, count: stream ? stream.viewers : 0 });
    }
    res.json({ total: runtime.getTotalViewers() });
  } catch (err) {
    logger.error('Public viewers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
