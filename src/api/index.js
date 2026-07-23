'use strict';

/**
 * Mubasher Core v2.0 - API Server (HLS Manager Integration)
 * 
 * All endpoints read from RuntimeRegistry (single source of truth).
 * No direct module calls. Real-time data only.
 * 
 * HLS Proxy Layer with Segment Reference Counter:
 *   - All TS segments served through proxy with source headers
 *   - Segment Reference Counter (refCount) for safe deletion
 *   - Playlist cache-control: no-store (never cache)
 *   - Segment cache-control: public, max-age=30 (short cache)
 *   - HLS Debug endpoints for monitoring
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const config = require('../config');
const logger = require('../logger');
const runtime = require('../runtime');
const streamEngine = require('../stream-engine');
const viewerManager = require('../viewer-manager');
const channels = require('../channels');
const sources = require('../sources');
const hlsManager = require('../hls-manager');

/**
 * Proxy a stream URL through Node.js with source headers.
 * This is the core proxy layer that protects original source URLs.
 */
function proxyStream(req, res, sourceUrl, options = {}) {
  const parsedUrl = url.parse(sourceUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const proxyOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.path,
    method: req.method || 'GET',
    headers: {
      'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
      'Range': req.headers.range || '',
      'Referer': options.referer || parsedUrl.href,
      'Origin': options.origin || parsedUrl.href,
      ...options.headers
    }
  };

  // Add cookies if provided
  if (options.cookie) {
    proxyOptions.headers['Cookie'] = options.cookie;
  }

  // Clean up empty headers
  for (const key of Object.keys(proxyOptions.headers)) {
    if (!proxyOptions.headers[key]) {
      delete proxyOptions.headers[key];
    }
  }

  const proxyReq = httpModule.request(proxyOptions, (proxyRes) => {
    // Forward status code
    res.status(proxyRes.statusCode);

    // Forward CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // Forward content headers
    if (proxyRes.headers['content-type']) {
      res.setHeader('Content-Type', proxyRes.headers['content-type']);
    }
    if (proxyRes.headers['content-length']) {
      res.setHeader('Content-Length', proxyRes.headers['content-length']);
    }
    if (proxyRes.headers['content-range']) {
      res.setHeader('Content-Range', proxyRes.headers['content-range']);
    }
    if (proxyRes.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', proxyRes.headers['accept-ranges']);
    }

    // Pipe the response
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      logger.error(`Proxy error for ${sourceUrl}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Proxy error' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    logger.error(`Proxy request error for ${sourceUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to source' });
    }
  });

  // Forward request body if any
  if (req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }

  proxyReq.end();
}

function createApp() {
  const app = express();

  app.use(express.json());

  // ── CORS ──────────────────────────────────────────────────
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Redirect root to viewer ───────────────────────────────
  app.get('/', (req, res) => {
    res.redirect('/viewer');
  });

  // ── Static files ──────────────────────────────────────────
  app.use('/viewer', express.static(path.join(__dirname, '..', 'viewer')));
  app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

  // ── API Router ────────────────────────────────────────────
  const router = express.Router();

  // ── Mount sub-routers FIRST so they take priority ─────────
  const adminRouter = require('./admin');
  const publicRouter = require('./public');

  router.use('/admin', adminRouter);
  router.use('/public', publicRouter);

  // ═══════════════════════════════════════════════════════════════
  // HLS PROXY LAYER WITH SEGMENT REFERENCE COUNTER
  // ═══════════════════════════════════════════════════════════════

  // ── HLS Playlist endpoint ──────────────────────────────────
  // Serves playlist with proxy-rewritten segment URLs
  // Cache-Control: no-store (never cache the playlist)
  router.get('/hls/:channelId/playlist.m3u8', async (req, res) => {
    const { channelId } = req.params;
    const hlsDir = path.join(process.cwd(), config.get().stream.hlsRoot || 'hls', channelId);
    const manifestPath = path.join(hlsDir, 'index.m3u8');
    const fileExists = fs.existsSync(manifestPath);
    
    // ── LOG CLIENT REQUEST ─────────────────────────────────
    logger.logClientRequest('GET', req.originalUrl, 'index.m3u8', fileExists, manifestPath);
    
    if (fileExists) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      
      // Update HLS Manager with playlist data
      hlsManager.updatePlaylist(channelId, content);
      
      // Rewrite segment URLs to go through proxy
      const rewritten = hlsManager.rewritePlaylist(channelId, content);
      
      // Cache-Control: no-store, no-cache, must-revalidate for playlists
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Expires', '0');
      res.setHeader('Pragma', 'no-cache');
      return res.send(rewritten);
    }
    
    // ── LOG PLAYLIST MISSING ───────────────────────────────
    logger.logPlaylistMissing(channelId, manifestPath, false, process.cwd());
    
    res.status(404).json({ error: 'Playlist not found' });
  });

  // ── HLS Segment endpoint ──────────────────────────────────
  // Serves TS files with Segment Reference Counter
  // Cache-Control: short cache for .ts files (30s)
  // If segment is missing, logs critical error to HLS Manager
  router.get('/hls/:channelId/segments/:segment', (req, res) => {
    const { channelId, segment } = req.params;
    
    // Security: prevent directory traversal
    if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    const hlsDir = path.join(process.cwd(), config.get().stream.hlsRoot || 'hls', channelId);
    const segmentPath = path.join(hlsDir, segment);
    
    if (fs.existsSync(segmentPath) && segmentPath.startsWith(hlsDir)) {
      // ── SEGMENT REFERENCE COUNTER ──────────────────────────
      // Lock the segment (increment refCount) while serving
      hlsManager.lockSegment(channelId, segment);
      
      // Set Cache-Control: short cache for .ts files (30s)
      res.setHeader('Content-Type', 'video/MP2T');
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Send file and unlock on completion
      const stream = fs.createReadStream(segmentPath);
      stream.pipe(res);
      
      stream.on('end', () => {
        // Unlock the segment (decrement refCount) when done
        hlsManager.unlockSegment(channelId, segment);
      });
      
      stream.on('error', (err) => {
        hlsManager.unlockSegment(channelId, segment);
        logger.error(`HLS segment error: ${channelId}/${segment}: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Segment read error' });
        }
      });
      
      return;
    }
    
    // ── SEGMENT MISS: Log critical error ─────────────────────
    // This is a critical error - playlist referenced a segment that doesn't exist
    hlsManager.handleSegmentMiss(channelId, segment);
    
    // Check if FFmpeg is running - segment might appear soon
    const channel = runtime.getChannel(channelId);
    const stream = runtime.getStream(channelId);
    
    if (channel && stream && (stream.state === 'ONLINE' || stream.state === 'BUFFERING' || stream.state === 'PROBING')) {
      res.setHeader('Retry-After', '1');
      return res.status(404).json({ error: 'Segment not yet available, retry' });
    }
    
    res.status(404).json({ error: 'Segment not found' });
  });

  // ── HLS Route with Lazy Startup ───────────────────────────
  // When viewer requests /hls/:channelId/index.m3u8 and stream is stopped,
  // auto-start FFmpeg and wait for first segment before replying.
  router.get('/hls/:channelId/index.m3u8', async (req, res) => {
    const { channelId } = req.params;

    try {
      const channel = runtime.getChannel(channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      if (!channel.enabled) {
        return res.status(403).json({ error: 'Channel is disabled' });
      }

      const stream = runtime.getStream(channelId);
      const streamState = stream ? stream.state : 'STOPPED';

      // Start stream if not running
      if (!stream || streamState === 'STOPPED' || streamState === 'ERROR') {
        logger.info(`HLS Lazy Startup: Starting stream for channel ${channelId}`);
        await streamEngine.addViewer(channelId, channel, 'lazy_' + Date.now());
      }

      // Wait up to 15 seconds for the manifest to appear
      const hlsDir = path.join(process.cwd(), config.get().stream.hlsRoot || 'hls', channelId);
      const manifestPath = path.join(hlsDir, 'index.m3u8');

      let waited = 0;
      const maxWait = 15000; // 15 seconds
      const interval = 500;

      while (waited < maxWait) {
        if (fs.existsSync(manifestPath)) {
          // Read the playlist and rewrite segment URLs to go through our proxy
          let content = fs.readFileSync(manifestPath, 'utf8');
          
          // Update HLS Manager with playlist
          hlsManager.updatePlaylist(channelId, content);
          
          // Rewrite segment URLs to go through our proxy
          content = hlsManager.rewritePlaylist(channelId, content);
          
          // Cache-Control: no-store for playlists
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Expires', '0');
          res.setHeader('Pragma', 'no-cache');
          return res.send(content);
        }
        await new Promise(r => setTimeout(r, interval));
        waited += interval;
      }

      // Timeout - stream failed to start
      return res.status(503).json({ error: 'Stream failed to start within timeout' });
    } catch (err) {
      logger.error(`HLS route error for ${channelId}: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Proxy a source URL with headers ───────────────────────
  // This endpoint allows proxying any URL with custom headers
  router.get('/proxy/:sourceId/*', (req, res) => {
    const sourceId = req.params.sourceId;
    const targetPath = req.params[0];
    
    const source = runtime.getSource(sourceId);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }
    
    // Build the full URL
    let fullUrl = targetPath;
    if (!fullUrl.startsWith('http')) {
      // Relative URL - prepend source base URL
      const baseUrl = source.baseUrl.replace(/\/+$/, '');
      fullUrl = `${baseUrl}/${targetPath}`;
    }
    
    // Proxy with source headers
    proxyStream(req, res, fullUrl, {
      referer: source.referer,
      origin: source.origin,
      userAgent: source.userAgent,
      cookie: source.cookie,
      headers: source.headers
    });
  });

  // ── Direct Stream Proxy ───────────────────────────────────
  // Proxy a direct stream URL with custom headers
  router.post('/proxy/stream', (req, res) => {
    const { url, headers, referer, origin, userAgent, cookie } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    proxyStream(req, res, url, {
      referer: referer || req.headers.referer,
      origin: origin || req.headers.origin,
      userAgent: userAgent || req.headers['user-agent'],
      cookie: cookie || req.headers.cookie,
      headers: headers || {}
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // HLS DEBUG ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // ── HLS Debug: All channels ───────────────────────────────
  // Shows real-time HLS monitoring data for all channels
  router.get('/hls/debug', (req, res) => {
    try {
      const monitors = hlsManager.getAllMonitors();
      res.json({
        channels: monitors,
        total: monitors.length,
        // Summary
        summary: {
          totalChannels: monitors.length,
          activeProducers: monitors.filter(m => m.producerRunning).length,
          activeSwaps: monitors.filter(m => m.swapInProgress).length,
          totalMisses: monitors.reduce((a, m) => a + m.segmentMisses, 0),
          totalDeletes: monitors.reduce((a, m) => a + m.segmentDeletes, 0),
          totalLocks: monitors.reduce((a, m) => a + m.segmentLocks, 0),
          totalSegmentsOnDisk: monitors.reduce((a, m) => a + m.segmentsOnDisk, 0)
        }
      });
    } catch (err) {
      logger.error('HLS debug error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── HLS Debug: Single channel ─────────────────────────────
  router.get('/hls/debug/:channelId', (req, res) => {
    try {
      const monitor = hlsManager.getMonitor(req.params.channelId);
      if (!monitor) {
        return res.status(404).json({ error: 'No HLS data for channel' });
      }
      res.json({ channel: monitor });
    } catch (err) {
      logger.error('HLS debug channel error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // LEGACY SUPPORT
  // ═══════════════════════════════════════════════════════════════

  // ── Legacy HLS Static Files (for backward compatibility) ─
  // Still serve HLS files directly for clients that don't use proxy
  app.use('/hls', (req, res, next) => {
    express.static(path.join(process.cwd(), 'hls'), {
      setHeaders: (res, filePath, stat) => {
        if (filePath.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          // Cache-Control: no-store for playlists
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Expires', '0');
          res.setHeader('Pragma', 'no-cache');
        } else if (filePath.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/MP2T');
          // Cache-Control: short cache for .ts files (30s)
          res.setHeader('Cache-Control', 'public, max-age=30');
        }
      }
    })(req, res, next);
  });

  // ── SSE: Real-time Dashboard Events ──────────────────────
  router.get('/admin/events', (req, res) => {
    // Auth check
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const cfg = config.get();
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user !== cfg.admin.username || pass !== cfg.admin.password) {
      return res.status(403).json({ error: 'Invalid credentials' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial snapshot
    const sendUpdate = () => {
      try {
        const dashboard = runtime.getDashboard();
        // Add HLS monitoring data
        const hlsMonitors = hlsManager.getAllMonitors();
        dashboard.hls = {
          monitors: hlsMonitors,
          summary: {
            totalChannels: hlsMonitors.length,
            activeProducers: hlsMonitors.filter(m => m.producerRunning).length,
            totalMisses: hlsMonitors.reduce((a, m) => a + m.segmentMisses, 0),
            totalDeletes: hlsMonitors.reduce((a, m) => a + m.segmentDeletes, 0),
            totalSegmentsOnDisk: hlsMonitors.reduce((a, m) => a + m.segmentsOnDisk, 0)
          }
        };
        res.write(`data: ${JSON.stringify({ type: 'update', data: dashboard })}\n\n`);
      } catch (_) {}
    };

    sendUpdate();
    const intervalId = setInterval(sendUpdate, 2000);

    req.on('close', () => {
      clearInterval(intervalId);
    });
  });

  // ── HLS Playlist Rewrite Middleware ───────────────────────
  // When serving HLS playlists, rewrite segment URLs to go through proxy
  app.use('/hls/:channelId/index.m3u8', (req, res, next) => {
    const channelId = req.params.channelId;
    const hlsDir = path.join(process.cwd(), config.get().stream.hlsRoot || 'hls', channelId);
    const manifestPath = path.join(hlsDir, 'index.m3u8');
    
    if (fs.existsSync(manifestPath)) {
      let content = fs.readFileSync(manifestPath, 'utf8');
      
      // Update HLS Manager
      hlsManager.updatePlaylist(channelId, content);
      
      // Rewrite segment URLs
      content = hlsManager.rewritePlaylist(channelId, content);
      
      // Cache-Control: no-store for playlists
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Expires', '0');
      res.setHeader('Pragma', 'no-cache');
      return res.send(content);
    }
    
    next();
  });

  // ── Health Check ──────────────────────────────────────────
  router.get('/health', (req, res) => {
    try {
      res.json({
        channels: runtime.getHealthSummary(),
        system: runtime.getSystemStats(),
        totalViewers: runtime.getTotalViewers()
      });
    } catch (err) {
      logger.error('Health check error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Status ────────────────────────────────────────────────
  app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', version: '2.0.0', uptime: process.uptime() });
  });

  // ── Mount all routes under /api ───────────────────────────
  app.use('/api', router);

  // ── 404 handler ───────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Error handler ─────────────────────────────────────────
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', { message: err.message, stack: err.stack?.slice(0, 300) });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };