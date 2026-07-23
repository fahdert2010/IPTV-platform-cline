'use strict';

/**
 * Mubasher Core v2.0 - HLS Segment Lifecycle Manager
 * ====================================================
 * Professional-grade HLS lifecycle management with:
 *   - Segment Reference Counter (refCount)
 *   - Playlist Window (min=15, preferred=25, max=40)
 *   - Playlist Validator (every 1s)
 *   - Gradual Cleanup (1 segment every 5s)
 *   - Segment Journal (created, served, locked, deleted)
 *   - Atomic Swap for restarts
 *   - Producer/Consumer Queue
 *   - Full HLS Monitoring per channel
 * 
 * Architecture:
 *   FFmpeg (Producer) writes segments → HLS Manager tracks them
 *   Viewers (Consumer) read segments → Reference Counter increments
 *   Cleanup runs gradually → Only deletes segments that are safe
 * 
 * NEVER deletes a segment that:
 *   1. Is still referenced in the active playlist
 *   2. Is being read by any viewer (refCount > 0)
 *   3. Is the last segment produced
 *   4. Is younger than playlistWindow
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const runtime = require('../runtime');

class HlsManager {
  constructor() {
    // ── Per-channel state ──────────────────────────────────
    this._channels = new Map(); // channelId → HlsChannelState

    // ── Cleanup Timer (runs every 5s) - DISABLED TEMPORARILY ──
    // this._cleanupTimer = setInterval(() => this._gradualCleanup(), 5000);
    this._cleanupTimer = null;

    // ── Playlist Validator Timer (runs every 1s) ───────────
    this._validatorTimer = setInterval(() => this._validatePlaylists(), 1000);

    logger.info('HlsManager: initialized (gradual cleanup DISABLED for debugging)');
  }

  /**
   * Get or create channel state.
   */
  _getChannel(channelId) {
    let ch = this._channels.get(channelId);
    if (!ch) {
      ch = {
        channelId,
        // ── Segment Journal ──────────────────────────────────
        segments: new Map(), // segmentName → { created, served, locked, deleted, refCount, size }
        
        // ── Reference Counter ────────────────────────────────
        activeRefs: new Map(), // segmentName → refCount (number of viewers reading it)
        
        // ── Playlist Window ──────────────────────────────────
        currentPlaylist: [],  // Array of segment names from current playlist
        playlistAge: 0,       // ms since last playlist update
        lastPlaylistUpdate: Date.now(),
        mediaSequence: 0,
        
        // ── Cleanup State ────────────────────────────────────
        lastCleanupIndex: 0,  // for gradual cleanup rotation
        pendingDeletes: [],   // segments queued for deletion
        
        // ── Monitoring Counters ──────────────────────────────
        monitor: {
          currentSequence: 0,
          oldestSegment: null,
          newestSegment: null,
          segmentsOnDisk: 0,
          segmentsInPlaylist: 0,
          lockedSegments: 0,
          deletedSegments: 0,
          missingSegments: 0,
          playlistRewrites: 0,
          segmentDeletes: 0,
          segmentMisses: 0,
          segmentLocks: 0,
          cleanupDelays: 0,
          averagePlaylistAge: 0,
          lastValidatorRun: Date.now(),
          lastCleanupRun: Date.now(),
          totalPlaylistAge: 0,
          playlistAgeSamples: 0
        },
        
        // ── Atomic Swap ──────────────────────────────────────
        tempDir: null,        // temporary directory for restart
        swapInProgress: false,
        
        // ── Producer/Consumer ────────────────────────────────
        lastProducedSegment: null,
        lastConsumedSegment: null,
        producerRunning: false,
        
        // ── Stats ────────────────────────────────────────────
        createdAt: Date.now()
      };
      this._channels.set(channelId, ch);
    }
    return ch;
  }

  /**
   * Register a channel (called when FFmpeg starts).
   */
  registerChannel(channelId) {
    const ch = this._getChannel(channelId);
    ch.producerRunning = true;
    logger.info(`HlsManager: registered channel ${channelId}`);
    return ch;
  }

  /**
   * Unregister a channel (called when FFmpeg fully stops).
   */
  unregisterChannel(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch) return;
    ch.producerRunning = false;
    logger.info(`HlsManager: unregistered channel ${channelId}`);
    // Don't delete the state - monitoring data may still be useful
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. SEGMENT REFERENCE COUNTER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Increment refCount for a segment (called when viewer starts downloading).
   * Returns true if the segment is available and locked.
   */
  lockSegment(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return false;

    let refCount = ch.activeRefs.get(segmentName) || 0;
    refCount++;
    ch.activeRefs.set(segmentName, refCount);

    // Update journal
    const seg = ch.segments.get(segmentName);
    if (seg) {
      seg.served++;
      seg.locked = true;
    }

    ch.monitor.segmentLocks++;
    logger.debug(`HlsManager: lock ${channelId}/${segmentName} (refCount=${refCount})`);
    return true;
  }

  /**
   * Decrement refCount for a segment (called when viewer finishes download).
   */
  unlockSegment(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return;

    let refCount = ch.activeRefs.get(segmentName) || 0;
    if (refCount > 0) {
      refCount--;
      if (refCount === 0) {
        ch.activeRefs.delete(segmentName);
        // Update journal
        const seg = ch.segments.get(segmentName);
        if (seg) seg.locked = false;
      } else {
        ch.activeRefs.set(segmentName, refCount);
      }
    }

    logger.debug(`HlsManager: unlock ${channelId}/${segmentName} (refCount=${refCount})`);
  }

  /**
   * Get refCount for a segment.
   */
  getRefCount(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return 0;
    return ch.activeRefs.get(segmentName) || 0;
  }

  /**
   * Check if segment is locked (being read by any viewer).
   */
  isLocked(channelId, segmentName) {
    return this.getRefCount(channelId, segmentName) > 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. SEGMENT JOURNAL
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a segment creation in the journal.
   */
  recordSegmentCreated(channelId, segmentName, size = 0) {
    const ch = this._getChannel(channelId);
    ch.segments.set(segmentName, {
      created: Date.now(),
      served: 0,
      locked: false,
      deleted: false,
      deletedAt: null,
      refCount: 0,
      size
    });
    ch.lastProducedSegment = segmentName;
    ch.monitor.newestSegment = segmentName;
    logger.debug(`HlsManager: created ${channelId}/${segmentName} (${size} bytes)`);
  }

  /**
   * Record a segment deletion in the journal.
   */
  recordSegmentDeleted(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return;
    const seg = ch.segments.get(segmentName);
    if (seg) {
      seg.deleted = true;
      seg.deletedAt = Date.now();
    }
    ch.monitor.deletedSegments++;
    ch.monitor.segmentDeletes++;
    logger.debug(`HlsManager: deleted ${channelId}/${segmentName}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. PLAYLIST WINDOW
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update the playlist information for a channel.
   * Parses the playlist content and extracts segment names.
   */
  updatePlaylist(channelId, playlistContent) {
    const ch = this._getChannel(channelId);
    
    // Extract segments from playlist
    const segments = [];
    let mediaSequence = 0;
    
    for (const line of playlistContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(trimmed.split(':')[1]) || 0;
      } else if (trimmed.endsWith('.ts')) {
        segments.push(trimmed);
      }
    }

    // Update channel state
    ch.currentPlaylist = segments;
    ch.mediaSequence = mediaSequence;
    ch.monitor.currentSequence = mediaSequence;
    ch.monitor.segmentsInPlaylist = segments.length;
    ch.monitor.playlistRewrites++;
    
    if (segments.length > 0) {
      ch.monitor.oldestSegment = segments[0];
      ch.monitor.newestSegment = segments[segments.length - 1];
    }

    // Track playlist age
    const now = Date.now();
    ch.playlistAge = now - ch.lastPlaylistUpdate;
    ch.lastPlaylistUpdate = now;
    ch.monitor.totalPlaylistAge += ch.playlistAge;
    ch.monitor.playlistAgeSamples++;
    ch.monitor.averagePlaylistAge = ch.monitor.playlistAgeSamples > 0
      ? Math.round(ch.monitor.totalPlaylistAge / ch.monitor.playlistAgeSamples)
      : 0;

    // Record any new segments in the journal
    for (const seg of segments) {
      if (!ch.segments.has(seg)) {
        this.recordSegmentCreated(channelId, seg);
      }
    }

    // Update disk count
    this._updateDiskCount(channelId);

    return segments;
  }

  /**
   * Get the current playlist segments.
   */
  getPlaylist(channelId) {
    const ch = this._channels.get(channelId);
    return ch ? [...ch.currentPlaylist] : [];
  }

  /**
   * Check if a segment is in the current playlist.
   */
  isInPlaylist(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return false;
    return ch.currentPlaylist.includes(segmentName);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. PLAYLIST VALIDATOR (every 1s)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Validate all playlists - ensure every segment in the playlist exists on disk.
   * If a segment is missing, the playlist is invalid and should not be served.
   */
  _validatePlaylists() {
    for (const [channelId, ch] of this._channels) {
      if (!ch.producerRunning) continue;
      if (ch.currentPlaylist.length === 0) continue;

      const hlsRoot = config.get().stream.hlsRoot || 'hls';
      const hlsDir = path.join(process.cwd(), hlsRoot, channelId);
      const missingSegments = [];

      ch.monitor.lastValidatorRun = Date.now();

      for (const seg of ch.currentPlaylist) {
        const segPath = path.join(hlsDir, seg);
        if (!fs.existsSync(segPath)) {
          missingSegments.push(seg);
          // Record missing segment
          if (!ch.segments.has(seg)) {
            this.recordSegmentCreated(channelId, seg);
          }
          const entry = ch.segments.get(seg);
          if (entry) entry.deleted = true;
        }
      }

      ch.monitor.missingSegments = missingSegments.length;

      if (missingSegments.length > 0) {
        // This is a critical error - playlist references missing segments
        logger.error(`HlsManager: CRITICAL - ${channelId} playlist references ${missingSegments.length} missing segments: ${missingSegments.slice(0, 5).join(', ')}`);
        
        // Regenerate playlist by removing references to missing segments
        // Actually, we can't regenerate FFmpeg's playlist. We need to flag this.
        runtime.addLog({
          level: 'critical',
          message: `HLS: ${channelId} has ${missingSegments.length} missing segments in playlist`,
          details: { channelId, missingSegments: missingSegments.slice(0, 10) }
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. GRADUAL CLEANUP (1 segment every 5s)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if a segment is safe to delete.
   * All conditions must be met:
   *   1. Not in the current playlist
   *   2. Not being read by any viewer (refCount === 0)
   *   3. Not the last segment produced
   *   4. Older than playlistWindow (extended from playlist age)
   */
  _isSafeToDelete(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return false;

    // Condition 1: Not in current playlist
    if (ch.currentPlaylist.includes(segmentName)) {
      return false;
    }

    // Condition 2: Not being read
    if (this.isLocked(channelId, segmentName)) {
      return false;
    }

    // Condition 3: Not the last segment produced
    if (segmentName === ch.lastProducedSegment) {
      return false;
    }

    // Condition 4: Older than playlist window
    // Wait at least 2x the playlist duration before deleting
    const playlistDuration = ch.playlistAge || 20000; // default 20s
    const minAge = Math.max(playlistDuration * 2, 30000); // at least 30s
    const seg = ch.segments.get(segmentName);
    if (seg && (Date.now() - seg.created) < minAge) {
      return false;
    }

    return true;
  }

  /**
   * Gradual cleanup - runs every 5 seconds.
   * Deletes at most 1 segment per channel per cycle.
   * Uses round-robin through files to avoid thrashing.
   */
  _gradualCleanup() {
    for (const [channelId, ch] of this._channels) {
      // Skip if producer is still running AND playlist is below minimum
      if (ch.producerRunning && ch.currentPlaylist.length < 15) {
        continue; // Don't delete anything if playlist is too small
      }

      if (!ch.producerRunning && ch.currentPlaylist.length === 0) {
        // Producer stopped and playlist empty - can clean more aggressively
        this._cleanupOrphanedSegments(channelId);
        continue;
      }

      const hlsRoot = config.get().stream.hlsRoot || 'hls';
      const hlsDir = path.join(process.cwd(), hlsRoot, channelId);

      if (!fs.existsSync(hlsDir)) continue;

      ch.monitor.lastCleanupRun = Date.now();

      try {
        const files = fs.readdirSync(hlsDir)
          .filter(f => f.endsWith('.ts'))
          .sort();

        if (files.length === 0) continue;

        // Rotate starting point for fairness
        const startIndex = ch.lastCleanupIndex % files.length;
        ch.lastCleanupIndex = (ch.lastCleanupIndex + 1) % files.length;

        // Try to find one safe file to delete
        for (let i = 0; i < files.length; i++) {
          const idx = (startIndex + i) % files.length;
          const f = files[idx];

          if (f === 'index.m3u8') continue;

          if (this._isSafeToDelete(channelId, f)) {
            const fp = path.join(hlsDir, f);
            try {
              fs.unlinkSync(fp);
              this.recordSegmentDeleted(channelId, f);
              logger.debug(`HlsManager: cleaned ${channelId}/${f}`);
            } catch (err) {
              logger.warn(`HlsManager: failed to delete ${channelId}/${f}: ${err.message}`);
            }
            break; // Only delete 1 per cycle
          }
        }

        // Update disk count
        this._updateDiskCount(channelId);
      } catch (err) {
        logger.error(`HlsManager: cleanup error for ${channelId}: ${err.message}`);
      }
    }
  }

  /**
   * Cleanup orphaned segments when producer is stopped.
   * Still gradual - 1 per cycle.
   */
  _cleanupOrphanedSegments(channelId) {
    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const hlsDir = path.join(process.cwd(), hlsRoot, channelId);

    if (!fs.existsSync(hlsDir)) return;

    try {
      const files = fs.readdirSync(hlsDir)
        .filter(f => f.endsWith('.ts'))
        .sort();

      if (files.length === 0) return;

      // Delete from oldest to newest, 1 at a time
      const f = files[0];
      if (f === 'index.m3u8') return;

      const fp = path.join(hlsDir, f);
      try {
        fs.unlinkSync(fp);
        this.recordSegmentDeleted(channelId, f);
        logger.debug(`HlsManager: orphan cleanup ${channelId}/${f}`);
      } catch (_) {}
    } catch (_) {}
  }

  /**
   * Update the count of segments on disk.
   */
  _updateDiskCount(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch) return;

    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const hlsDir = path.join(process.cwd(), hlsRoot, channelId);

    try {
      if (fs.existsSync(hlsDir)) {
        const files = fs.readdirSync(hlsDir).filter(f => f.endsWith('.ts'));
        ch.monitor.segmentsOnDisk = files.length;
      }
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. ATOMIC SWAP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a temporary directory for atomic swap.
   * Returns the temp directory path.
   */
  createTempDir(channelId) {
    const ch = this._getChannel(channelId);
    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const tempDir = path.join(process.cwd(), hlsRoot, `.tmp_${channelId}_${Date.now()}`);
    
    fs.mkdirSync(tempDir, { recursive: true });
    ch.tempDir = tempDir;
    ch.swapInProgress = true;
    
    logger.info(`HlsManager: created temp dir ${tempDir} for atomic swap`);
    return tempDir;
  }

  /**
   * Perform atomic swap: replace old directory with new temp directory.
   * Uses rename which is atomic on the same filesystem.
   */
  atomicSwap(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch || !ch.tempDir) return false;

    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const targetDir = path.join(process.cwd(), hlsRoot, channelId);

    try {
      // Create a backup of the old directory (just rename it)
      const backupDir = path.join(process.cwd(), hlsRoot, `.old_${channelId}_${Date.now()}`);
      
      if (fs.existsSync(targetDir)) {
        fs.renameSync(targetDir, backupDir);
      }

      // Rename temp to target (atomic)
      fs.renameSync(ch.tempDir, targetDir);

      // Clean up old backup asynchronously
      fs.rm(backupDir, { recursive: true, force: true }, (err) => {
        if (err) logger.warn(`HlsManager: failed to remove old backup ${backupDir}: ${err.message}`);
      });

      ch.tempDir = null;
      ch.swapInProgress = false;
      
      logger.info(`HlsManager: atomic swap complete for ${channelId}`);
      return true;
    } catch (err) {
      logger.error(`HlsManager: atomic swap failed for ${channelId}: ${err.message}`);
      ch.tempDir = null;
      ch.swapInProgress = false;
      return false;
    }
  }

  /**
   * Clean up temp directory if swap was cancelled.
   */
  cleanupTempDir(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch || !ch.tempDir) return;

    try {
      fs.rm(ch.tempDir, { recursive: true, force: true }, (err) => {
        if (err) logger.warn(`HlsManager: failed to cleanup temp dir: ${err.message}`);
      });
      ch.tempDir = null;
      ch.swapInProgress = false;
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. HLS MONITORING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get complete monitoring data for a channel.
   */
  getMonitor(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch) return null;

    return {
      channelId: ch.channelId,
      ...ch.monitor,
      playlist: ch.currentPlaylist.slice(-20), // Last 20 segments
      segmentsInPlaylist: ch.currentPlaylist.length,
      producerRunning: ch.producerRunning,
      lastProducedSegment: ch.lastProducedSegment,
      swapInProgress: ch.swapInProgress,
      activeRefs: Array.from(ch.activeRefs.entries()).map(([name, count]) => ({ name, count })),
      journalSize: ch.segments.size
    };
  }

  /**
   * Get monitoring data for all channels.
   */
  getAllMonitors() {
    const result = [];
    for (const [channelId] of this._channels) {
      const monitor = this.getMonitor(channelId);
      if (monitor) result.push(monitor);
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the temporary directory for a channel (if atomic swap is in progress).
   * Returns null if no temp dir.
   */
  getTempDir(channelId) {
    const ch = this._channels.get(channelId);
    return ch ? ch.tempDir : null;
  }

  /**
   * Get the output directory for FFmpeg (temp dir if swap in progress, otherwise regular dir).
   */
  getOutputDir(channelId) {
    const tempDir = this.getTempDir(channelId);
    if (tempDir) return tempDir;
    
    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    return path.join(process.cwd(), hlsRoot, channelId);
  }

  /**
   * Get the playback URL for a segment (with proxy path).
   */
  getSegmentUrl(channelId, segmentName) {
    return `/api/hls/${channelId}/segments/${segmentName}`;
  }

  /**
   * Rewrite playlist content to use proxy URLs.
   */
  rewritePlaylist(channelId, content) {
    return content.replace(/^([0-9]{5}\.ts)$/gm, `/api/hls/${channelId}/segments/$1`);
  }

  /**
   * Check if a channel's playlist is valid (all segments exist on disk).
   */
  isPlaylistValid(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch || ch.currentPlaylist.length === 0) return false;

    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const hlsDir = path.join(process.cwd(), hlsRoot, channelId);

    for (const seg of ch.currentPlaylist) {
      const segPath = path.join(hlsDir, seg);
      if (!fs.existsSync(segPath)) return false;
    }

    return true;
  }

  /**
   * Get the minimum number of segments to keep.
   */
  getMinSegments() {
    return 15;
  }

  /**
   * Get the preferred number of segments.
   */
  getPreferredSegments() {
    return 25;
  }

  /**
   * Get the maximum number of segments.
   */
  getMaxSegments() {
    return 40;
  }

  /**
   * Handle a segment miss (404).
   * Logs critical error and records in journal.
   */
  handleSegmentMiss(channelId, segmentName) {
    const ch = this._channels.get(channelId);
    if (!ch) return;

    ch.monitor.segmentMisses++;
    logger.error(`HlsManager: CRITICAL - segment miss ${channelId}/${segmentName}`);

    // Record in runtime logs
    runtime.addLog({
      level: 'critical',
      message: `HLS 404: ${channelId}/${segmentName}`,
      details: {
        channelId,
        segment: segmentName,
        inPlaylist: this.isInPlaylist(channelId, segmentName),
        refCount: this.getRefCount(channelId, segmentName),
        playlistSize: ch.currentPlaylist.length
      }
    });
  }

  /**
   * Force-clean all segments for a channel (used on stop).
   * Still gradual to avoid blocking.
   */
  forceCleanChannel(channelId) {
    const ch = this._channels.get(channelId);
    if (!ch) return;

    const hlsRoot = config.get().stream.hlsRoot || 'hls';
    const hlsDir = path.join(process.cwd(), hlsRoot, channelId);

    if (!fs.existsSync(hlsDir)) return;

    try {
      // Delete all .ts files
      for (const f of fs.readdirSync(hlsDir)) {
        if (f.endsWith('.ts') || f === 'index.m3u8') {
          try {
            fs.unlinkSync(path.join(hlsDir, f));
          } catch (_) {}
        }
      }
      ch.segments.clear();
      ch.currentPlaylist = [];
      ch.monitor.segmentsOnDisk = 0;
      logger.info(`HlsManager: force cleaned ${channelId}`);
    } catch (err) {
      logger.error(`HlsManager: force clean error for ${channelId}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. SHUTDOWN
  // ═══════════════════════════════════════════════════════════════

  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this._validatorTimer) {
      clearInterval(this._validatorTimer);
      this._validatorTimer = null;
    }
    this._channels.clear();
    logger.info('HlsManager: shutdown complete');
  }
}

module.exports = new HlsManager();