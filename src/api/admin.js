'use strict';

const express = require('express');
const config = require('../config');
const storage = require('../storage');
const logger = require('../logger');
const sources = require('../sources');
const channels = require('../channels');
const ffmpegManager = require('../ffmpeg');
const heartbeat = require('../heartbeat');

const router = express.Router();

// Auth middleware
router.use((req, res, next) => {
  const cfg = config.get();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"');
    return res.status(401).json({ error: 'Authentication required' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user !== cfg.admin.username || pass !== cfg.admin.password) {
    return res.status(403).json({ error: 'Invalid credentials' });
  }
  next();
});

// ── Dashboard ──

router.get('/dashboard', (req, res) => {
  const allChannels = channels.getAll();
  const allSources = sources.getAll();
  const activeStreams = ffmpegManager.getAllStatus();
  const totalViewers = heartbeat.getTotalViewers();

  res.json({
    totalChannels: allChannels.length,
    enabledChannels: allChannels.filter(c => c.enabled).length,
    totalSources: allSources.length,
    enabledSources: allSources.filter(s => s.enabled).length,
    activeStreams: activeStreams.length,
    totalViewers,
    uptime: process.uptime(),
    streams: activeStreams
  });
});

// ── Channels ──

router.get('/channels', (req, res) => {
  const { search, group, source } = req.query;
  let result = channels.getAll();

  if (search) result = result.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.group.toLowerCase().includes(search.toLowerCase())
  );
  if (group) result = result.filter(c => c.group === group);
  if (source) result = result.filter(c => c.sourceId === source);

  res.json({ channels: result, total: result.length });
});

router.get('/channels/groups', (req, res) => {
  res.json({ groups: channels.getGroups() });
});

router.get('/channels/:id', (req, res) => {
  const ch = channels.getById(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: ch });
});

router.post('/channels', (req, res) => {
  const ch = channels.add(req.body);
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
  const deleted = channels.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Channel not found' });
  logger.info(`Admin: deleted channel ${req.params.id}`);
  res.json({ ok: true });
});

router.post('/channels/:id/test', async (req, res) => {
  const ch = channels.getById(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const health = await ffmpegManager.probeStream(ch.url);
  channels.update(ch.id, { health });
  res.json({ channel: ch.name, ...health });
});

router.post('/channels/:id/enable', (req, res) => {
  const ch = channels.update(req.params.id, { enabled: true });
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: ch });
});

router.post('/channels/:id/disable', (req, res) => {
  const ch = channels.update(req.params.id, { enabled: false });
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: ch });
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

// ── Streams ──

router.get('/streams', (req, res) => {
  res.json({ streams: ffmpegManager.getAllStatus() });
});

router.post('/streams/:channelId/stop', (req, res) => {
  ffmpegManager.stop(req.params.channelId);
  res.json({ ok: true });
});

router.post('/streams/:channelId/start', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  ffmpegManager.addViewer(req.params.channelId, url);
  res.json({ ok: true, channelId: req.params.channelId });
});

// ── Health ──

router.post('/health/test', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const result = await ffmpegManager.probeStream(url);
  res.json(result);
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

// ── Logs ──

router.get('/logs', (req, res) => {
  const loggerModule = require('../logger');
  res.json({ logs: loggerModule.getBuffer() });
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

const UPLOAD_DIR = require('path').join(process.cwd(), 'data', 'uploads');
if (!require('fs').existsSync(UPLOAD_DIR)) require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });

const fileUpload = require('multer')({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/sources/import-file', fileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    const name = req.body.name || req.file.originalname.replace(/\.(m3u|m3u8)$/i, '') || 'Local Import';
    const filePath = req.file.path;
    
    const src = sources.add({ name, type: 'm3u_file', url: filePath });
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

module.exports = router;
