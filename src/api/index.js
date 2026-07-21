'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const publicRoutes = require('./public');
const adminRoutes = require('./admin');

function createApp() {
  const app = express();

  // Global middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // API Status
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      name: 'Mubasher Core',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Public API
  app.use('/api/public', publicRoutes);

  // Admin API
  app.use('/api/admin', adminRoutes);

  // Serve viewer static files at /viewer
  const viewerPath = path.join(__dirname, '..', 'viewer');
  app.use('/viewer', express.static(viewerPath, { index: 'index.html' }));

  // Serve admin static files at /admin
  const adminPath = path.join(__dirname, '..', 'admin');
  app.use('/admin', express.static(adminPath, { index: 'index.html' }));

  // Serve public static files at /public
  const publicPath = path.join(process.cwd(), 'public');
  app.use('/public', express.static(publicPath));

  // Root redirects to /viewer
  app.get('/', (req, res) => {
    res.redirect('/viewer');
  });

  // HLS cache
  const cfg = config.get();
  const hlsRoot = path.join(process.cwd(), cfg.stream.hlsRoot || 'hls');
  app.use('/hls', express.static(hlsRoot));

  // 404 handler - return JSON for API, redirect to viewer for others
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found', path: req.path });
    }
    // For any unknown path, serve the viewer index
    res.sendFile(path.join(viewerPath, 'index.html'));
  });

  // Error handler
  app.use((err, req, res, next) => {
    logger.error('API Error', { error: err.message, path: req.path });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };