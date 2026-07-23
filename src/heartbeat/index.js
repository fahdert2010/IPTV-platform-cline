'use strict';

const config = require('../config');
const logger = require('../logger');
const runtime = require('../runtime');
const streamEngine = require('../stream-engine');

/**
 * Heartbeat Module v2.0 — Tracks active viewers via RuntimeRegistry.
 * All state writes go through RuntimeRegistry (single source of truth).
 * Stream idle timeout is managed by stream-engine.
 */
class HeartbeatManager {
  constructor() {
    this.viewers = new Map(); // clientId -> { clientId, channelId, lastBeat }
    this.timer = null;
  }

  /**
   * Start the heartbeat monitoring interval.
   */
  start() {
    const cfg = config.get();
    const intervalMs = cfg.heartbeat.intervalMs || 15000;

    this.timer = setInterval(() => {
      this.checkTimeouts();
    }, intervalMs);

    logger.info('Heartbeat: started monitoring');
  }

  /**
   * Stop the heartbeat monitoring.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Heartbeat: stopped');
  }

  /**
   * Receive a heartbeat from a viewer.
   * @param {string} clientId - Unique viewer identifier
   * @param {string} channelId - Channel being watched
   */
  beat(clientId, channelId) {
    if (!clientId || !channelId) return;

    const existing = this.viewers.get(clientId);

    if (existing) {
      // Viewer switched channel
      if (existing.channelId !== channelId) {
        streamEngine.removeViewer(existing.channelId, clientId);
        streamEngine.addViewer(channelId, null, clientId);
        existing.channelId = channelId;
      }
      existing.lastBeat = Date.now();
    } else {
      // New viewer
      this.viewers.set(clientId, { clientId, channelId, lastBeat: Date.now() });
      streamEngine.addViewer(channelId, null, clientId);
    }

    // Update RuntimeRegistry viewer heartbeat
    runtime.setViewer(clientId, {
      currentChannel: channelId,
      lastHeartbeat: Date.now(),
      status: 'connected'
    });
  }

  /**
   * Remove a viewer manually (on disconnect).
   */
  remove(clientId) {
    const viewer = this.viewers.get(clientId);
    if (viewer) {
      streamEngine.removeViewer(viewer.channelId, clientId);
      runtime.removeViewer(clientId);
      this.viewers.delete(clientId);
    }
  }

  /**
   * Check for timed-out viewers and remove them.
   */
  checkTimeouts() {
    const cfg = config.get();
    const timeoutMs = (cfg.heartbeat.viewerTimeoutSeconds || 60) * 1000;
    const now = Date.now();

    for (const [clientId, viewer] of this.viewers) {
      if (now - viewer.lastBeat > timeoutMs) {
        streamEngine.removeViewer(viewer.channelId, clientId);
        runtime.removeViewer(clientId);
        this.viewers.delete(clientId);
      }
    }
  }

  /**
   * Get active viewer count for a channel.
   */
  getViewerCount(channelId) {
    let count = 0;
    for (const viewer of this.viewers.values()) {
      if (viewer.channelId === channelId) count++;
    }
    return count;
  }

  /**
   * Get total active viewers across all channels.
   */
  getTotalViewers() {
    return this.viewers.size;
  }

  /**
   * Get all active viewers.
   */
  getAllViewers() {
    return [...this.viewers.values()];
  }
}

module.exports = new HeartbeatManager();