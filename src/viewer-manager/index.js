'use strict';

/**
 * Mubasher Core v2.0 - Viewer Manager
 * =====================================
 * Manages viewer sessions across all channels.
 * All state written to RuntimeRegistry.
 * No duplicate storage - everything flows through registry.
 */

const runtime = require('../runtime');
const logger = require('../logger');

class ViewerManager {
  constructor() {
    this._geoCache = new Map(); // ip → { country, city, isp }
  }

  /**
   * Register a new viewer or update existing.
   */
  register(viewerId, channelId, info = {}) {
    const now = Date.now();
    const ip = info.ip || 'unknown';

    // Try to get geo info from IP (simplified - would use geoip in production)
    const geo = this._geoCache.get(ip) || { country: '', city: '', isp: '' };
    const ua = info.userAgent || '';
    const device = this._detectDevice(ua);
    const browser = this._detectBrowser(ua);
    const os = this._detectOS(ua);

    return runtime.setViewer(viewerId, {
      ip,
      country: geo.country,
      city: geo.city,
      isp: geo.isp,
      device,
      browser,
      os,
      platform: device === 'Mobile' ? 'mobile' : 'web',
      userAgent: ua,
      currentChannel: channelId,
      status: 'connected',
      startTime: now,
      lastHeartbeat: now
    });
  }

  /**
   * Update heartbeat for a viewer.
   */
  heartbeat(viewerId, channelId, stats = {}) {
    const viewer = runtime.getViewer(viewerId);
    if (!viewer) return;

    const now = Date.now();
    const watchTime = viewer.startTime ? (now - viewer.startTime) / 1000 : 0;

    runtime.setViewer(viewerId, {
      currentChannel: channelId,
      lastHeartbeat: now,
      watchTime,
      bandwidth: stats.bandwidth || viewer.bandwidth,
      bitrate: stats.bitrate || viewer.bitrate,
      latency: stats.latency || viewer.latency,
      packetLoss: stats.packetLoss || viewer.packetLoss,
      bufferEvents: stats.bufferEvents || 0,
      segmentsLoaded: stats.segmentsLoaded || 0,
      segmentsFailed: stats.segmentsFailed || 0
    });
  }

  /**
   * Disconnect a viewer.
   */
  disconnect(viewerId) {
    const viewer = runtime.getViewer(viewerId);
    if (!viewer) return;

    const watchTime = viewer.startTime ? (Date.now() - viewer.startTime) / 1000 : 0;
    runtime.setViewer(viewerId, { status: 'disconnected', watchTime });
    logger.info(`ViewerManager: ${viewerId} disconnected (watched ${Math.round(watchTime)}s)`);
  }

  /**
   * Remove a viewer entirely.
   */
  remove(viewerId) {
    runtime.removeViewer(viewerId);
  }

  /**
   * Kick a viewer (force disconnect).
   */
  kick(viewerId) {
    runtime.setViewer(viewerId, { kicked: true, status: 'disconnected' });
    logger.info(`ViewerManager: kicked ${viewerId}`);
  }

  /**
   * Ban a viewer.
   */
  ban(viewerId) {
    runtime.setViewer(viewerId, { banned: true, kicked: true, status: 'disconnected' });
    logger.info(`ViewerManager: banned ${viewerId}`);
  }

  /**
   * Get viewers for a specific channel.
   */
  getViewersByChannel(channelId) {
    return runtime.getViewers({ channelId, status: 'connected' });
  }

  /**
   * Get all viewers.
   */
  getAllViewers() {
    return runtime.getViewers();
  }

  /**
   * Get viewer statistics.
   */
  getStats() {
    const viewers = runtime.getViewers();
    const connected = viewers.filter(v => v.status === 'connected');
    const totalWatchTime = viewers.reduce((s, v) => s + (v.watchTime || 0), 0);
    const totalBandwidth = connected.reduce((s, v) => s + (v.bandwidth || 0), 0);
    const avgLatency = connected.length > 0
      ? Math.round(connected.reduce((s, v) => s + (v.latency || 0), 0) / connected.length)
      : 0;

    return {
      total: viewers.length,
      connected: connected.length,
      totalWatchTime: Math.round(totalWatchTime),
      totalBandwidth: Math.round(totalBandwidth),
      averageLatency: avgLatency,
      peakViewers: Math.max(...viewers.map(v => v.watchTime || 0)) || 0
    };
  }

  /**
   * Get device distribution.
   */
  getDeviceDistribution() {
    const dist = runtime.getViewerDistribution();
    return dist.devices;
  }

  /**
   * Get browser distribution.
   */
  getBrowserDistribution() {
    const dist = runtime.getViewerDistribution();
    return dist.browsers;
  }

  /**
   * Recover a viewer after server restart.
   */
  async recoverViewer(viewerData) {
    // Re-register the viewer after restart
    if (viewerData && viewerData.id) {
      runtime.setViewer(viewerData.id, {
        ...viewerData,
        status: 'connected',
        lastHeartbeat: Date.now(),
        reconnectCount: (viewerData.reconnectCount || 0) + 1
      });
      logger.info(`ViewerManager: recovered viewer ${viewerData.id}`);
      return true;
    }
    return false;
  }

  // ── User Agent Parsing ────────────────────────────────────

  _detectDevice(ua) {
    if (!ua) return 'Unknown';
    ua = ua.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
    if (ua.includes('android')) return 'Android';
    if (ua.includes('smarttv') || ua.includes('webos') || ua.includes('tizen')) return 'Smart TV';
    if (ua.includes('roku')) return 'Roku';
    if (ua.includes('firetv') || ua.includes('aft')) return 'Fire TV';
    if (ua.includes('apple tv')) return 'Apple TV';
    if (ua.includes('mobile')) return 'Mobile';
    if (ua.includes('tablet')) return 'Tablet';
    if (ua.includes('windows') || ua.includes('mac') || ua.includes('linux')) return 'Desktop';
    return 'Unknown';
  }

  _detectBrowser(ua) {
    if (!ua) return 'Unknown';
    ua = ua.toLowerCase();
    if (ua.includes('edge')) return 'Edge';
    if (ua.includes('chrome') && !ua.includes('edge')) return 'Chrome';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('opera') || ua.includes('opr')) return 'Opera';
    if (ua.includes('msie') || ua.includes('trident')) return 'Internet Explorer';
    return 'Unknown';
  }

  _detectOS(ua) {
    if (!ua) return 'Unknown';
    ua = ua.toLowerCase();
    if (ua.includes('windows')) return 'Windows';
    if (ua.includes('mac os') || ua.includes('macintosh')) return 'macOS';
    if (ua.includes('android')) return 'Android';
    if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
    if (ua.includes('linux')) return 'Linux';
    if (ua.includes('webos')) return 'WebOS';
    if (ua.includes('tizen')) return 'Tizen';
    return 'Unknown';
  }

  shutdown() {
    logger.info('ViewerManager: shutdown');
  }
}

module.exports = new ViewerManager();