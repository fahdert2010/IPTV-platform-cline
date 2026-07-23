'use strict';

const express = require('express');
const config = require('../config');
const storage = require('../storage');
const logger = require('../logger');
const runtime = require('../runtime');
const sources = require('../sources');
const channels = require('../channels');
const streamEngine = require('../stream-engine');
const viewerManager = require('../viewer-manager');
const healthSystem = require('../health');
const cache = require('../cache');

const router = express.Router();

// Auth middleware
router.use((req, res, next) => {
  const cfg = config.get();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user !== cfg.admin.username || pass !== cfg.admin.password) {
    return res.status(403).json({ error: 'Invalid credentials' });
  }
  next();
});

// ── Dashboard (reads exclusively from RuntimeRegistry) ──

router.get('/dashboard', (req, res) => {
  try {
    const dashboard = runtime.getDashboard();
    res.json(dashboard);
  } catch (err) {
    logger.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Channels ──

router.get('/channels', (req, res) => {
  try {
    const { search, group, source } = req.query;
    let result = runtime.getChannels();

    if (search) result = result.filter(c => 
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.group || '').toLowerCase().includes(search.toLowerCase())
    );
    if (group) result = result.filter(c => c.group === group);
    if (source) result = result.filter(c => c.primarySource === source);

    res.json({ channels: result, total: result.length });
  } catch (err) {
    logger.error('Admin channels error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/channels/groups', (req, res) => {
  try {
    res.json({ groups: channels.getGroups() });
  } catch (err) {
    logger.error('Admin groups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/channels/:id', (req, res) => {
  try {
    const ch = runtime.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel: ch });
  } catch (err) {
    logger.error('Admin channel detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/channels', (req, res) => {
  const { primarySource, primaryStreamId, url } = req.body;
  // LAW-001: Every channel must have a source reference or direct URL
  const hasSourceRef = primarySource && primaryStreamId;
  const hasDirectUrl = url && url.trim().length > 0;
  if (!hasSourceRef && !hasDirectUrl) {
    return res.status(400).json({
      error: 'Channel must have either primarySource+primaryStreamId or a direct url'
    });
  }
  const ch = channels.add(req.body);
  healthSystem.recordEvent('channel_created');
  logger.info(`Admin: created channel "${ch.name}"`);
  res.status(201).json({ channel: ch });
});

router.put('/channels/:id', (req, res) => {
  const ch = channels.update(req.params.id, req.body);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  logger.info(`Admin: updated channel "${ch.name}"`);
  res.json({ channel: ch });
});

router.delete('/channels/:id', (req, res) => {
  // Stop stream first
  streamEngine.stop(req.params.id);
  cache.clearChannel(req.params.id);
  const deleted = channels.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Channel not found' });
  logger.info(`Admin: deleted channel ${req.params.id}`);
  res.json({ ok: true });
});

router.post('/channels/:id/test', async (req, res) => {
  const ch = channels.getById(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  // Resolve URL via source binding, fallback to direct url
  const streamUrl = channels.getStreamUrl(ch.id, sources);
  const testUrl = streamUrl ? streamUrl.url : (ch.url || '');
  if (!testUrl) {
    return res.status(400).json({ error: 'Channel has no source binding or direct URL to test' });
  }
  const result = await healthSystem.testStream(testUrl);
  channels.update(ch.id, { health: { isOnline: result.isOnline, ...result } });
  res.json({ channel: ch.name, ...result });
});

router.post('/channels/:id/enable', (req, res) => {
  const ch = channels.update(req.params.id, { enabled: true });
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: ch });
});

router.post('/channels/:id/disable', (req, res) => {
  const ch = channels.update(req.params.id, { enabled: false });
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  // Stop stream for disabled channel
  streamEngine.stop(req.params.id);
  res.json({ channel: ch });
});

// Bulk operations
router.post('/channels/bulk/enable', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  let count = 0;
  for (const id of ids) {
    if (channels.update(id, { enabled: true })) count++;
  }
  res.json({ ok: true, count });
});

router.post('/channels/bulk/disable', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  let count = 0;
  for (const id of ids) {
    if (channels.update(id, { enabled: false })) {
      streamEngine.stop(id);
      count++;
    }
  }
  res.json({ ok: true, count });
});

router.post('/channels/bulk/delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  let count = 0;
  for (const id of ids) {
    streamEngine.stop(id);
    cache.clearChannel(id);
    if (channels.remove(id)) count++;
  }
  res.json({ ok: true, count });
});

router.post('/channels/bulk/test', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  
  const results = [];
  for (const id of ids) {
    const ch = channels.getById(id);
    if (ch) {
      // Resolve URL via source binding, fallback to direct url
      const streamUrl = channels.getStreamUrl(ch.id, sources);
      const testUrl = streamUrl ? streamUrl.url : (ch.url || '');
      if (!testUrl) {
        results.push({ id, name: ch.name, error: 'No source binding or direct URL' });
        continue;
      }
      const health = await healthSystem.probeStream(testUrl);
      channels.update(id, { health: { isOnline: health.isOnline, ...health } });
      results.push({ id, name: ch.name, ...health });
    }
  }
  res.json({ results, total: results.length });
});

// ── Sources ──

router.get('/sources', (req, res) => {
  res.json({ sources: sources.getAll() });
});

router.get('/sources/:id', (req, res) => {
  const src = sources.getById(req.params.id);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  res.json({ source: src });
});

router.post('/sources', (req, res) => {
  const src = sources.add(req.body);
  logger.info(`Admin: created source "${src.name}"`);
  res.status(201).json({ source: src });
});

router.put('/sources/:id', (req, res) => {
  const src = sources.update(req.params.id, req.body);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  logger.info(`Admin: updated source "${src.name}"`);
  res.json({ source: src });
});

router.delete('/sources/:id', (req, res) => {
  const deleted = sources.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Source not found' });
  logger.info(`Admin: deleted source ${req.params.id}`);
  res.json({ ok: true });
});

router.post('/sources/:id/enable', (req, res) => {
  const src = sources.update(req.params.id, { enabled: true });
  if (!src) return res.status(404).json({ error: 'Source not found' });
  res.json({ source: src });
});

router.post('/sources/:id/disable', (req, res) => {
  const src = sources.update(req.params.id, { enabled: false });
  if (!src) return res.status(404).json({ error: 'Source not found' });
  res.json({ source: src });
});

router.post('/sources/:id/import', async (req, res) => {
  const src = sources.getById(req.params.id);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  const result = await sources.importChannels(src);
  res.json(result);
});

router.post('/sources/:id/resync', async (req, res) => {
  const result = await sources.resync(req.params.id);
  if (!result) return res.status(404).json({ error: 'Source not found' });
  res.json(result);
});

router.post('/sources/import-all', async (req, res) => {
  const result = await sources.importAllEnabled();
  res.json(result);
});

// ── Streams (Stream Engine) ──

router.get('/streams', (req, res) => {
  res.json({ streams: streamEngine.getAllStatus() });
});

router.get('/streams/:channelId', (req, res) => {
  const status = streamEngine.getStatus(req.params.channelId);
  if (!status) return res.status(404).json({ error: 'Stream not found' });
  res.json({ stream: status });
});

router.post('/streams/:channelId/start', (req, res) => {
  const ch = channels.getById(req.params.channelId);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const { url } = req.body;
  streamEngine.addViewer(req.params.channelId, ch, 'admin_' + Date.now());
  res.json({ ok: true, channelId: req.params.channelId, state: streamEngine.getState(req.params.channelId) });
});

router.post('/streams/:channelId/stop', (req, res) => {
  streamEngine.stop(req.params.channelId);
  res.json({ ok: true });
});

router.post('/streams/:channelId/restart', (req, res) => {
  const ch = channels.getById(req.params.channelId);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  streamEngine.stop(req.params.channelId);
  setTimeout(() => {
    streamEngine.addViewer(req.params.channelId, ch, 'admin_restart_' + Date.now());
  }, 1000);
  res.json({ ok: true, message: 'Restarting stream' });
});

// ── Health ──

router.post('/health/test', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const result = await healthSystem.testStream(url);
  res.json(result);
});

router.get('/health', (req, res) => {
  res.json({ channels: healthSystem.getAllHealth() });
});

router.get('/health/:channelId', (req, res) => {
  const health = healthSystem.getHealth(req.params.channelId);
  if (!health) return res.status(404).json({ error: 'No health data for channel' });
  res.json({ health });
});

// ── Viewers ──

router.get('/viewers', (req, res) => {
  const { channelId } = req.query;
  if (channelId) {
    const viewers = viewerManager.getViewersByChannel(channelId);
    return res.json({ channelId, viewers, count: viewers.length });
  }
  res.json({
    viewers: viewerManager.getAllViewers(),
    stats: viewerManager.getStats(),
    devices: viewerManager.getDeviceDistribution(),
    browsers: viewerManager.getBrowserDistribution()
  });
});

router.post('/viewers/:viewerId/kick', (req, res) => {
  const { channelId } = req.body;
  if (channelId) {
    streamEngine.removeViewer(channelId, req.params.viewerId);
  }
  viewerManager.remove(req.params.viewerId);
  res.json({ ok: true });
});

// ── Cache ──

router.get('/cache', (req, res) => {
  res.json(cache.getMetrics());
});

router.post('/cache/clear', (req, res) => {
  const { channelId } = req.body;
  if (channelId) {
    cache.clearChannel(channelId);
  } else {
    // Clear everything
    const allChannels = channels.getAll();
    for (const ch of allChannels) {
      cache.clearChannel(ch.id);
    }
  }
  res.json({ ok: true, message: channelId ? `Cleared cache for ${channelId}` : 'Cleared all cache' });
});

// ── Config ──

router.get('/config', (req, res) => {
  res.json({ config: config.get() });
});

router.put('/config', (req, res) => {
  const updates = req.body;
  for (const [key, value] of Object.entries(updates)) {
    config.set(key, value);
  }
  res.json({ config: config.get() });
});

// ── System ──

router.post('/system/restart-streams', (req, res) => {
  streamEngine.stopAll();
  res.json({ ok: true, message: 'All streams stopped' });
});

router.post('/system/gc', (req, res) => {
  if (global.gc) {
    global.gc();
    res.json({ ok: true, message: 'Garbage collection triggered' });
  } else {
    res.json({ ok: false, message: 'GC not exposed (run with --expose-gc)' });
  }
});

// ── Logs ──

router.get('/logs', (req, res) => {
  const loggerModule = require('../logger');
  const { level, search, limit } = req.query;
  let logs = loggerModule.getBuffer() || [];
  
  if (level) logs = logs.filter(l => l.level === level);
  if (search) logs = logs.filter(l => l.message.toLowerCase().includes(search.toLowerCase()));
  if (limit) logs = logs.slice(0, parseInt(limit));
  
  res.json({ logs, total: logs.length });
});

router.delete('/logs', (req, res) => {
  res.json({ ok: true });
});

// ── Backup & Restore ──

router.post('/backup', (req, res) => {
  const collections = ['channels', 'sources'];
  const results = {};
  for (const col of collections) {
    results[col] = storage.backup(col);
  }
  res.json({ ok: true, backups: results });
});

router.post('/restore/:collection', (req, res) => {
  const restored = storage.restore(req.params.collection);
  if (!restored) return res.status(404).json({ error: 'No backup found' });
  res.json({ ok: true });
});

// ── Import Local File ──

const filePath = require('path');
const UPLOAD_DIR = filePath.join(process.cwd(), 'data', 'uploads');
if (!require('fs').existsSync(UPLOAD_DIR)) require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });

const fileUpload = require('multer')({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/sources/import-file', fileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    const name = req.body.name || req.file.originalname.replace(/\.(m3u|m3u8)$/i, '') || 'Local Import';
    const filePath = req.file.path;
    
    const src = sources.add({ name, type: 'm3u_file', baseUrl: filePath });
    const result = await sources.importChannels(sources.getById(src.id));
    
    res.json({ source: src, ...result });
  } catch (err) {
    logger.error('File import failed', { error: err.message });
    if (req.file && req.file.path) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  }
});

// ── M3U Upload Endpoint (multipart) ──────────────────────────
router.post('/sources/upload', fileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    const name = req.body.name || req.file.originalname.replace(/\.(m3u|m3u8)$/i, '') || 'M3U Upload';
    const filePath = req.file.path;
    
    const src = sources.add({ name, type: 'm3u_file', baseUrl: filePath });
    const result = await sources.importChannels(sources.getById(src.id));
    
    // Log import summary
    logger.info(`Admin: M3U upload "${name}" — added ${result.added || 0}, updated ${result.updated || 0}`);
    
    res.json({ success: true, source: { id: src.id, name: src.name }, ...result });
  } catch (err) {
    logger.error('M3U upload failed', { error: err.message });
    if (req.file && req.file.path) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;