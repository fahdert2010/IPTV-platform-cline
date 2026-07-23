'use strict';

/**
 * Mubasher Core v2.0 - Health Engine
 * ===================================
 * Real-time health monitoring for all channels.
 * Writes all data to RuntimeRegistry.
 * No duplicate storage - everything flows through registry.
 */

const runtime = require('../runtime');
const logger = require('../logger');

class HealthSystem {
  constructor() {
    this._eventCounts = {
      viewer_connected: 0,
      viewer_disconnected: 0,
      reconnect: 0,
      error: 0,
      channel_created: 0,
      channel_deleted: 0,
      source_imported: 0
    };
  }

  /**
   * Record health data for a channel.
   */
  recordHealth(channelId, data) {
    return runtime.setHealth(channelId, data);
  }

  /**
   * Get health data for a channel.
   */
  getHealth(channelId) {
    return runtime.getHealth(channelId);
  }

  /**
   * Get all health data.
   */
  getAllHealth() {
    return Array.from(runtime._health.values()).map(h => ({ ...h }));
  }

  /**
   * Get health summary.
   */
  getHealthSummary() {
    return runtime.getHealthSummary();
  }

  /**
   * Record a system event.
   */
  recordEvent(type) {
    if (type in this._eventCounts) {
      this._eventCounts[type]++;
    }
    runtime.addLog({ type, level: 'info', message: `Event: ${type}` });
  }

  /**
   * Get event statistics.
   */
  getEventStats() {
    return { ...this._eventCounts };
  }

  /**
   * Test a stream URL using ffprobe.
   */
  async testStream(url) {
    const { spawn } = require('child_process');
    const config = require('../config');
    const cfg = config.get();
    const ffprobePath = cfg.ffmpeg.ffprobePath || 'ffprobe';
    const startTime = Date.now();

    return new Promise((resolve) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        '-timeout', '10000000',
        url
      ];

      const proc = spawn(ffprobePath, args, { timeout: 15000, windowsHide: true });
      let stdout = '', stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        const responseTime = Date.now() - startTime;
        if (code !== 0) {
          return resolve({
            isOnline: false,
            responseTime,
            error: stderr.slice(0, 300),
            score: 0
          });
        }

        try {
          const info = JSON.parse(stdout);
          const vStream = (info.streams || []).find(s => s.codec_type === 'video');
          const aStream = (info.streams || []).find(s => s.codec_type === 'audio');
          const format = info.format || {};

          let score = 100;
          if (responseTime > 5000) score -= 20;
          if (!vStream) score -= 30;
          if (!aStream) score -= 10;

          resolve({
            isOnline: true,
            score: Math.max(0, score),
            codec: vStream ? vStream.codec_name : null,
            resolution: vStream ? `${vStream.width}x${vStream.height}` : null,
            fps: vStream ? this._evalFps(vStream.r_frame_rate || vStream.avg_frame_rate) : null,
            audio: aStream ? aStream.codec_name : null,
            audioSampleRate: aStream ? aStream.sample_rate : null,
            bitrate: format.bit_rate ? parseInt(format.bit_rate) : null,
            latency: format.start_time ? parseFloat(format.start_time) * 1000 : 0,
            container: format.format_name || null,
            responseTime
          });
        } catch (_) {
          resolve({ isOnline: true, responseTime, score: 50, error: 'Parse failed' });
        }
      });

      proc.on('error', (err) => {
        resolve({ isOnline: false, responseTime: Date.now() - startTime, error: err.message, score: 0 });
      });
    });
  }

  /**
   * Probe a stream URL (more detailed than test).
   */
  async probeStream(url) {
    return this.testStream(url);
  }

  _evalFps(fpsStr) {
    if (!fpsStr) return null;
    const parts = fpsStr.split('/');
    if (parts.length === 2) {
      const n = parseFloat(parts[0]), d = parseFloat(parts[1]);
      if (d && n) return Math.round((n / d) * 100) / 100;
    }
    return parseFloat(fpsStr) || null;
  }

  shutdown() {
    logger.info('HealthSystem: shutdown');
  }
}

module.exports = new HealthSystem();