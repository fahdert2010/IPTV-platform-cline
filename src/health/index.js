'use strict';

/**
 * Health Check Module — Probes stream URLs and monitors system health.
 *
 * Responsibilities:
 *   - Test individual stream URLs with ffprobe
 *   - Batch test all enabled channels
 *   - Report system health summary (uptime, active streams, channels)
 *
 * Exports:
 *   testStream(url)             → Promise<Object>
 *   testAllChannels()           → Promise<Array>
 *   getSystemHealth()           → Object
 */

class HealthCheck {
  async testStream(url) {
    return { isOnline: false, codec: null, resolution: null, fps: null, audio: null, responseTime: 0 };
  }

  async testAllChannels() {
    return [];
  }

  getSystemHealth() {
    return { status: 'ok', uptime: 0, totalChannels: 0, enabledChannels: 0, activeStreams: 0, streams: [] };
  }
}

module.exports = new HealthCheck();