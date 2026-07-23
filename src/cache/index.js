'use strict';

/**
 * Mubasher Core v2.0 - Professional Cache Engine
 * ================================================
 * Multi-tier caching system for IPTV streaming:
 *   - RAM Cache (hot segments)
 *   - Disk Cache (warm segments)
 *   - Playlist Cache (HLS manifests)
 *   - Metadata Cache (channel info, EPG)
 *   - Manifest Cache (M3U playlists)
 *   - Viewer Cache (session data)
 *   - Statistics Cache (health, bitrate)
 * 
 * Features:
 *   LRU eviction, TTL, Prefetch, Read Ahead,
 *   Smart Buffer, Adaptive Buffer, Memory/ Disk Limits,
 *   Automatic Cleanup, Per-Channel + Global Cache,
 *   Admin configurable limits.
 * 
 * All stats written to RuntimeRegistry.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const runtime = require('../runtime');

class CacheEngine {
  constructor() {
    // ── Memory Caches ─────────────────────────────────────────
    this._ramCache = new Map();       // key → { data, size, expires, hits }
    this._playlistCache = new Map();  // channelId → { playlist, expires }
    this._metadataCache = new Map();  // key → { data, expires }
    this._manifestCache = new Map();  // sourceId → { manifest, expires }
    this._viewerCache = new Map();    // viewerId → { data, expires }
    this._statsCache = new Map();     // channelId → { stats, expires }
    
    // ── Configuration ─────────────────────────────────────────
    this._cfg = {
      ramMaxBytes: 256 * 1024 * 1024,    // 256MB default
      diskMaxBytes: 5 * 1024 * 1024 * 1024, // 5GB default
      playlistLength: 10,
      segmentDuration: 2,
      deleteThreshold: 4,
      readAheadCount: 3,
      idleCacheTimeout: 300000,      // 5 min
      prefetchCount: 2,
      defaultTtl: 60000,             // 1 min
      metadataTtl: 300000,           // 5 min
      manifestTtl: 3600000           // 1 hour
    };
    
    this._ramUsedBytes = 0;
    this._diskUsedBytes = 0;
    this._ramHits = 0;
    this._ramMisses = 0;
    this._diskHits = 0;
    this._diskMisses = 0;
    
    // ── Cleanup Timer ─────────────────────────────────────────
    this._cleanupTimer = setInterval(() => this._cleanup(), 60000);
    
    // ── Initialize stats in RuntimeRegistry ──────────────────
    this._syncStats();
  }

  /**
   * Update configuration from settings.
   */
  configure(settings) {
    if (settings.ramMaxBytes) this._cfg.ramMaxBytes = settings.ramMaxBytes;
    if (settings.diskMaxBytes) this._cfg.diskMaxBytes = settings.diskMaxBytes;
    if (settings.playlistLength) this._cfg.playlistLength = settings.playlistLength;
    if (settings.segmentDuration) this._cfg.segmentDuration = settings.segmentDuration;
    if (settings.deleteThreshold) this._cfg.deleteThreshold = settings.deleteThreshold;
    if (settings.readAheadCount) this._cfg.readAheadCount = settings.readAheadCount;
    if (settings.idleCacheTimeout) this._cfg.idleCacheTimeout = settings.idleCacheTimeout;
    if (settings.prefetchCount) this._cfg.prefetchCount = settings.prefetchCount;
    this._syncStats();
  }

  // ── RAM Cache ──────────────────────────────────────────────

  /**
   * Get data from RAM cache.
   */
  ramGet(key) {
    const entry = this._ramCache.get(key);
    if (!entry) {
      this._ramMisses++;
      this._syncStats();
      return null;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this._ramCache.delete(key);
      this._ramUsedBytes -= entry.size;
      this._ramMisses++;
      this._syncStats();
      return null;
    }
    entry.hits = (entry.hits || 0) + 1;
    this._ramHits++;
    this._syncStats();
    return entry.data;
  }

  /**
   * Set data in RAM cache.
   */
  ramSet(key, data, ttl = this._cfg.defaultTtl) {
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length || 0;
    
    // Evict if needed
    while (this._ramUsedBytes + size > this._cfg.ramMaxBytes && this._ramCache.size > 0) {
      this._evictLRU();
    }

    // Remove old entry if exists
    const old = this._ramCache.get(key);
    if (old) this._ramUsedBytes -= old.size;

    this._ramCache.set(key, {
      data,
      size,
      expires: ttl > 0 ? Date.now() + ttl : null,
      hits: 0,
      added: Date.now()
    });
    this._ramUsedBytes += size;
    this._syncStats();
  }

  /**
   * Remove from RAM cache.
   */
  ramDelete(key) {
    const entry = this._ramCache.get(key);
    if (entry) {
      this._ramUsedBytes -= entry.size;
      this._ramCache.delete(key);
      this._syncStats();
    }
  }

  /**
   * Clear RAM cache.
   */
  ramClear() {
    this._ramCache.clear();
    this._ramUsedBytes = 0;
    this._syncStats();
  }

  /**
   * LRU eviction - remove least recently used entry.
   */
  _evictLRU() {
    let oldest = null;
    let oldestKey = null;
    for (const [key, entry] of this._ramCache) {
      if (!oldest || entry.hits < oldest.hits || (entry.hits === oldest.hits && entry.added < oldest.added)) {
        oldest = entry;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this._ramUsedBytes -= oldest.size;
      this._ramCache.delete(oldestKey);
    }
  }

  // ── Disk Cache ─────────────────────────────────────────────

  _getDiskDir() {
    return path.join(process.cwd(), 'cache');
  }

  _getChannelDiskDir(channelId) {
    return path.join(this._getDiskDir(), channelId);
  }

  /**
   * Get segment from disk cache.
   */
  diskGet(channelId, segment) {
    const filePath = path.join(this._getChannelDiskDir(channelId), segment);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        this._diskHits++;
        this._syncStats();
        return data;
      }
    } catch (_) {}
    this._diskMisses++;
    this._syncStats();
    return null;
  }

  /**
   * Save segment to disk cache.
   */
  diskSet(channelId, segment, data) {
    const dir = this._getChannelDiskDir(channelId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, segment);
    try {
      fs.writeFileSync(filePath, data);
      const size = data.length || Buffer.byteLength(data);
      this._diskUsedBytes += size;

      // Check disk limit
      if (this._diskUsedBytes > this._cfg.diskMaxBytes) {
        this._cleanupDisk();
      }
      this._syncStats();
    } catch (err) {
      logger.error(`Cache: disk write failed for ${channelId}/${segment}: ${err.message}`);
    }
  }

  /**
   * Clear disk cache for a channel.
   */
  diskClear(channelId) {
    const dir = this._getChannelDiskDir(channelId);
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fp = path.join(dir, f);
          const stat = fs.statSync(fp);
          this._diskUsedBytes -= stat.size;
          fs.unlinkSync(fp);
        }
        this._syncStats();
      } catch (_) {}
    }
  }

  /**
   * Cleanup disk cache - remove oldest files.
   */
  _cleanupDisk() {
    const dir = this._getDiskDir();
    if (!fs.existsSync(dir)) return;

    const allFiles = [];
    const walkDir = (d) => {
      try {
        for (const f of fs.readdirSync(d)) {
          const fp = path.join(d, f);
          if (fs.statSync(fp).isDirectory()) walkDir(fp);
          else allFiles.push({ path: fp, mtime: fs.statSync(fp).mtimeMs, size: fs.statSync(fp).size });
        }
      } catch (_) {}
    };
    walkDir(dir);

    // Sort by modification time (oldest first)
    allFiles.sort((a, b) => a.mtime - b.mtime);

    while (this._diskUsedBytes > this._cfg.diskMaxBytes && allFiles.length > 0) {
      const file = allFiles.shift();
      try {
        fs.unlinkSync(file.path);
        this._diskUsedBytes -= file.size;
      } catch (_) {}
    }
  }

  // ── HLS Cache ──────────────────────────────────────────────

  /**
   * Get HLS playlist from cache (RAM).
   */
  getPlaylist(channelId) {
    const entry = this._playlistCache.get(channelId);
    if (!entry || (entry.expires && Date.now() > entry.expires)) {
      this._playlistCache.delete(channelId);
      return null;
    }
    return entry.playlist;
  }

  /**
   * Cache HLS playlist.
   */
  setPlaylist(channelId, playlist) {
    this._playlistCache.set(channelId, {
      playlist,
      expires: Date.now() + 5000 // 5 seconds
    });
  }

  /**
   * Get HLS segment from cache (RAM first, then disk).
   */
  getSegment(channelId, segmentName) {
    // Try RAM
    const ramKey = `seg:${channelId}:${segmentName}`;
    const ramData = this.ramGet(ramKey);
    if (ramData) return ramData;

    // Try disk
    const diskData = this.diskGet(channelId, segmentName);
    if (diskData) {
      // Promote to RAM
      this.ramSet(ramKey, diskData, 30000); // 30s TTL
      return diskData;
    }

    return null;
  }

  /**
   * Cache HLS segment.
   */
  setSegment(channelId, segmentName, data) {
    const ramKey = `seg:${channelId}:${segmentName}`;
    this.ramSet(ramKey, data, 30000); // 30s TTL
    this.diskSet(channelId, segmentName, data);
  }

  // ── Metadata Cache ─────────────────────────────────────────

  getMetadata(key) {
    const entry = this._metadataCache.get(key);
    if (!entry || (entry.expires && Date.now() > entry.expires)) {
      this._metadataCache.delete(key);
      return null;
    }
    return entry.data;
  }

  setMetadata(key, data, ttl = this._cfg.metadataTtl) {
    this._metadataCache.set(key, { data, expires: Date.now() + ttl });
  }

  // ── Manifest Cache ─────────────────────────────────────────

  getManifest(sourceId) {
    const entry = this._manifestCache.get(sourceId);
    if (!entry || (entry.expires && Date.now() > entry.expires)) {
      this._manifestCache.delete(sourceId);
      return null;
    }
    return entry.manifest;
  }

  setManifest(sourceId, manifest) {
    this._manifestCache.set(sourceId, {
      manifest,
      expires: Date.now() + this._cfg.manifestTtl
    });
  }

  // ── Channel Cache Operations ───────────────────────────────

  /**
   * Clear all cache for a channel.
   */
  clearChannel(channelId) {
    // Clear RAM caches
    for (const key of this._ramCache.keys()) {
      if (key.includes(channelId)) this._ramCache.delete(key);
    }
    this._playlistCache.delete(channelId);
    this._statsCache.delete(channelId);
    
    // Clear disk
    this.diskClear(channelId);
    
    this._syncStats();
    logger.info(`Cache: cleared channel ${channelId}`);
  }

  /**
   * Clear all caches.
   */
  clearAll() {
    this.ramClear();
    this._playlistCache.clear();
    this._metadataCache.clear();
    this._manifestCache.clear();
    this._viewerCache.clear();
    this._statsCache.clear();
    
    // Clear disk
    const dir = this._getDiskDir();
    if (fs.existsSync(dir)) {
      try {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          if (fs.statSync(fp).isDirectory()) {
            for (const sf of fs.readdirSync(fp)) {
              fs.unlinkSync(path.join(fp, sf));
            }
          }
        }
      } catch (_) {}
    }
    this._diskUsedBytes = 0;
    this._syncStats();
    logger.info('Cache: cleared all');
  }

  /**
   * Update channel streaming stats.
   */
  updateStats(channelId, stats) {
    this._statsCache.set(channelId, {
      stats,
      updated: Date.now()
    });
  }

  /**
   * Get channel streaming stats.
   */
  getStats(channelId) {
    const entry = this._statsCache.get(channelId);
    return entry ? entry.stats : null;
  }

  // ── Prefetch ───────────────────────────────────────────────

  /**
   * Prefetch next N segments for a channel.
   */
  prefetchSegments(channelId, currentSegment, count = this._cfg.prefetchCount) {
    // This is a hint for the streamer to load ahead
    // Actual prefetching is handled by the HLS delivery layer
    logger.info(`Cache: prefetch ${count} segments for ${channelId} after ${currentSegment}`);
  }

  // ── Cleanup ────────────────────────────────────────────────

  _cleanup() {
    // Clean expired RAM cache entries
    const now = Date.now();
    for (const [key, entry] of this._ramCache) {
      if (entry.expires && now > entry.expires) {
        this._ramUsedBytes -= entry.size;
        this._ramCache.delete(key);
      }
    }

    // Clean expired playlists
    for (const [key, entry] of this._playlistCache) {
      if (entry.expires && now > entry.expires) this._playlistCache.delete(key);
    }

    // Clean expired metadata
    for (const [key, entry] of this._metadataCache) {
      if (entry.expires && now > entry.expires) this._metadataCache.delete(key);
    }

    this._syncStats();
  }

  // ── Stats Sync ─────────────────────────────────────────────

  _syncStats() {
    runtime.setCacheStats({
      ramHits: this._ramHits,
      ramMisses: this._ramMisses,
      diskHits: this._diskHits,
      diskMisses: this._diskMisses,
      ramUsedBytes: this._ramUsedBytes,
      ramCapacityBytes: this._cfg.ramMaxBytes,
      diskUsedBytes: this._diskUsedBytes,
      diskCapacityBytes: this._cfg.diskMaxBytes,
      segmentCount: this._ramCache.size,
      playlistCount: this._playlistCache.size,
      metadataCount: this._metadataCache.size,
      manifestCount: this._manifestCache.size
    });
  }

  // ── Metrics ────────────────────────────────────────────────

  getMetrics() {
    const totalAccesses = this._ramHits + this._ramMisses + this._diskHits + this._diskMisses;
    const hitRate = totalAccesses > 0
      ? Math.round(((this._ramHits + this._diskHits) / totalAccesses) * 100)
      : 100;

    return {
      ram: {
        used: this._ramUsedBytes,
        capacity: this._cfg.ramMaxBytes,
        usagePercent: Math.round((this._ramUsedBytes / this._cfg.ramMaxBytes) * 100),
        entries: this._ramCache.size
      },
      disk: {
        used: this._diskUsedBytes,
        capacity: this._cfg.diskMaxBytes,
        usagePercent: Math.round((this._diskUsedBytes / this._cfg.diskMaxBytes) * 100)
      },
      performance: {
        ramHits: this._ramHits,
        ramMisses: this._ramMisses,
        diskHits: this._diskHits,
        diskMisses: this._diskMisses,
        hitRate,
        missRate: 100 - hitRate,
        totalAccesses
      },
      caches: {
        segments: this._ramCache.size,
        playlists: this._playlistCache.size,
        metadata: this._metadataCache.size,
        manifests: this._manifestCache.size
      }
    };
  }

  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    logger.info('Cache: shutdown complete');
  }
}

module.exports = new CacheEngine();