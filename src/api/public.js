'use strict';

const express = require('express');
const router = express.Router();
const channels = require('../channels');
const ffmpegManager = require('../ffmpeg');
const heartbeat = require('../heartbeat');
const logger = require('../logger');

/**
 * GET /api/public/settings
 * Returns public settings for the viewer interface.
 */
router.get('/settings', (req, res) => {
  res.json({
    settings: {
      siteName: 'Mubasher Core',
      logo: '',
      phone: '',
      ticker: '',
      cpuSaverDefault: true,
      playerMaxBufferLength: 20,
      playerBackBufferLength: 10,
      playerLiveSyncDuration: 4,
      capLevelToPlayerSize: true
    }
  });
});

/**
 * GET /api/public/channels
 * Returns ALL channels (enabled and disabled) for the viewer.
 * The viewer shows all channels, disabled ones are grayed out.
 */
router.get('/channels', (req, res) => {
  const allChannels = channels.getAll();
  res.json({ channels: allChannels, total: allChannels.length });
});

/**
 * GET /api/public/channel-health?id=
 * Check health of a specific channel.
 */
router.get('/channel-health', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Channel ID required' });
  const ch = channels.getById(id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({
    id: ch.id,
    name: ch.name,
    status: ch.health?.isOnline ? 'online' : 'offline',
    isOnline: ch.health?.isOnline || false,
    codec: ch.health?.codec || null,
    resolution: ch.health?.resolution || null,
    fps: ch.health?.fps || null,
    audio: ch.health?.audio || null,
    responseTime: ch.health?.responseTime || 0
  });
});

/**
 * POST /api/public/heartbeat
 * Receive heartbeat from a viewer.
 */
router.post('/heartbeat', (req, res) => {
  const { channelId, clientId } = req.body;
  if (!channelId || !clientId) {
    return res.status(400).json({ error: 'channelId and clientId required' });
  }
  const viewerCount = heartbeat.beat(clientId, channelId);
  res.json({ ok: true, viewers: viewerCount || 0 });
});

/**
 * POST /api/public/stream-action/:channelId/start
 * Start FFmpeg for a channel (viewer-triggered, no auth).
 */
router.post('/stream-action/:channelId/start', (req, res) => {
  const { channelId } = req.params;
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  
  // ────── LOG STEP 2: API called ──────
  logger.info('══════════ VIEWER TRACE ══════════');
  logger.info(`STEP 2: API /api/public/stream-action/${channelId}/start called`);
  logger.info(`STEP 2: Source URL: ${url}`);
  
  ffmpegManager.addViewer(channelId, url);
  logger.info(`STEP 2: ffmpegManager.addViewer() completed`);
  logger.info(`Public: started stream ${channelId}`);
  res.json({ ok: true, channelId, message: 'Stream starting' });
});

/**
 * POST /api/public/stream-action/:channelId/stop
 * Stop FFmpeg for a channel.
 */
router.post('/stream-action/:channelId/stop', (req, res) => {
  const { channelId } = req.params;
  ffmpegManager.stop(channelId);
  logger.info(`Public: stopped stream ${channelId}`);
  res.json({ ok: true, channelId, message: 'Stream stopped' });
});

/**
 * GET /api/public/stream/:channelId.m3u8
 * Serve the HLS playlist for a channel.
 */
router.get('/stream/:channelId.m3u8', (req, res) => {
  const { channelId } = req.params;
  const status = ffmpegManager.getStatus(channelId);
  if (!status || !status.isRunning) {
    return res.status(503).json({
      status: 'stopped',
      message: 'Stream is not running. Start the stream first.'
    });
  }
  const hlsPath = ffmpegManager.getHlsPath(channelId);
  if (!hlsPath) {
    return res.status(202).json({
      status: 'preparing',
      message: 'Stream is being prepared, please retry in a few seconds'
    });
  }
  const fs = require('fs');
  if (fs.existsSync(hlsPath)) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.sendFile(hlsPath);
  } else {
    res.status(202).json({
      status: 'preparing',
      message: 'HLS playlist not ready yet'
    });
  }
});

/**
 * GET /api/public/stream/:channelId/:segment
 * Serve HLS segments.
 */
router.get('/stream/:channelId/:segment', (req, res) => {
  const { channelId, segment } = req.params;
  const hlsDir = ffmpegManager.getHlsDir(channelId);
  if (!hlsDir) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  const path = require('path');
  const segPath = path.join(hlsDir, segment);
  // Security: prevent directory traversal
  if (!segPath.startsWith(hlsDir)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (require('fs').existsSync(segPath)) {
    const ext = path.extname(segment).toLowerCase();
    const mime = ext === '.ts' ? 'video/MP2T' : ext === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.sendFile(segPath);
  } else {
    res.status(404).json({ error: 'Segment not found' });
  }
});

module.exports = router;