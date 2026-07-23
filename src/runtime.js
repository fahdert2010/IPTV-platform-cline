'use strict';

/**
 * Mubasher Core v2.0 - RuntimeRegistry
 * ======================================
 * Single source of truth for ALL runtime data.
 * No module owns its own data. Everything flows through here.
 * 
 * Architecture:
 *   Channel Repository → (writes channel metadata)
 *   Source Repository  → (writes source metadata)
 *   Stream Engine      → (writes stream state)
 *   Viewer Manager     → (writes viewer sessions)
 *   Cache Engine       → (writes cache stats)
 *   Health Engine      → (writes health data)
 *   Scheduler          → (reads/writes schedules)
 *   Dashboard          → (reads ONLY from here)
 *   Public API         → (reads ONLY from here)
 */

const EventEmitter = require('events');

class RuntimeRegistry {
  constructor() {
    this._version = 0;
    
    // ── Core Data Stores ──────────────────────────────────────
    this._channels = new Map();      // channelId → ChannelState (metadata + runtime)
    this._sources = new Map();       // sourceId  → SourceState
    this._streams = new Map();       // channelId → StreamState (runtime only)
    this._viewers = new Map();       // viewerId  → ViewerSession
    this._health = new Map();        // channelId → HealthData
    this._cache = null;              // CacheStats
    this._system = null;             // SystemStats
    this._schedules = new Map();     // scheduleId → ScheduleData
    this._logs = [];                 // ring buffer of recent events
    
    // ── Defaults ──────────────────────────────────────────────
    this._resetCacheStats();
    this._resetSystemStats();
    
    // ── Events ────────────────────────────────────────────────
    this._events = new EventEmitter();
    this._events.setMaxListeners(500);
    
    // ── Periodic System Poll ──────────────────────────────────
    this._pollTimer = setInterval(() => this._pollSystem(), 5000);
  }
  
  // ── Version ────────────────────────────────────────────────
  get version() { return this._version; }
  get events() { return this._events; }
  
  _bump() { this._version = (this._version + 1) % 2147483647; }
  
  on(event, listener) { this._events.on(event, listener); return this; }
  off(event, listener) { this._events.off(event, listener); return this; }
  emit(event, data) { process.nextTick(() => this._events.emit(event, data)); }
  
  // ── Log Ring Buffer ───────────────────────────────────────
  addLog(entry) {
    this._logs.unshift({
      ...entry,
      timestamp: Date.now()
    });
    if (this._logs.length > 500) this._logs.length = 500;
    this._bump();
    this.emit('log:entry', entry);
  }
  
  getLogs(limit = 100) {
    return this._logs.slice(0, limit);
  }
  
  // ── Channels ──────────────────────────────────────────────
  
  /**
   * Register or update a channel's metadata AND runtime state.
   * Called by Channel Repository on load/update AND by Stream Engine on state change.
   */
  setChannel(channelId, data) {
    let entry = this._channels.get(channelId);
    const isNew = !entry;
    
    if (!entry) {
      entry = {
        id: channelId,
        name: '',
        number: 0,
        group: '',
        logo: '',
        epgId: '',
        tvgId: '',
        language: '',
        country: '',
        enabled: true,
        hidden: false,
        favorite: false,
        adult: false,
        locked: false,
        archive: false,
        priority: 0,
        primarySource: null,
        primaryStreamId: null,
        backupSource1: null,
        backupStreamId1: null,
        backupSource2: null,
        backupStreamId2: null,
        backupSource3: null,
        backupStreamId3: null,
        // Direct URL support
        url: '',
        referer: '',
        origin: '',
        userAgent: '',
        cookie: '',
        headers: {},
        proxy: '',
        dns: '',
        viewerLimit: 0,
        idleTimeout: 30,
        bufferSize: 4096,
        reconnectAttempts: 10,
        segmentDuration: 2,
        playlistSize: 10,
        deleteThreshold: 4,
        diskCacheSize: 5120,
        ramCacheSize: 256,
        ffmpegProfile: 'default',
        hardwareDecode: false,
        hardwareEncode: false,
        videoCodec: 'copy',
        audioCodec: 'copy',
        bitrate: 0,
        resolution: '',
        fps: null,
        customFfmpegArgs: '',
        // Runtime state (set by stream engine)
        state: 'STOPPED',
        prevState: null,
        viewerCount: 0,
        healthScore: null,
        pid: null,
        cpu: 0,
        memory: 0,
        startedAt: null,
        uptime: 0,
        currentUrl: '',
        currentUrlIndex: 0,
        reconnectCount: 0,
        lastStateChange: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this._channels.set(channelId, entry);
    }
    
    // Merge only provided fields (support partial updates)
    let stateChanged = false;
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      
      if (k === 'state' && v !== entry.state) {
        entry.prevState = entry.state;
        entry.state = v;
        entry.lastStateChange = Date.now();
        stateChanged = true;
      } else if (k === 'viewerCount') {
        entry.viewerCount = Math.max(0, typeof v === 'number' ? v : 0);
      } else if (k === 'pid') {
        entry.pid = v || null;
      } else if (k === 'uptime') {
        entry.uptime = v;
      } else if (k === 'startedAt') {
        entry.startedAt = v || entry.startedAt;
      } else {
        entry[k] = v;
      }
    }
    
    entry.updatedAt = Date.now();
    this._bump();
    
    if (isNew) {
      this.emit('channel:created', { channelId, channel: entry });
    }
    if (stateChanged) {
      this.emit('channel:state', {
        channelId,
        state: entry.state,
        prevState: entry.prevState,
        viewerCount: entry.viewerCount,
        name: entry.name
      });
    }
    this.emit('channel:updated', { channelId });
    
    return entry;
  }
  
  /**
   * Bulk update channels - efficient for bulk operations.
   */
  bulkSetChannels(channelsMap) {
    const updates = [];
    for (const [id, data] of channelsMap) {
      const entry = this.setChannel(id, data);
      updates.push(entry);
    }
    this.emit('channels:bulk', { count: updates.length });
    return updates;
  }
  
  getChannel(channelId) {
    return this._channels.get(channelId) || null;
  }
  
  /**
   * Get ALL channels with full metadata + runtime state.
   * This is the single source of truth for dashboards and APIs.
   */
  getChannels(filter = {}) {
    const result = [];
    for (const [, ch] of this._channels) {
      // Apply filters
      if (filter.enabled !== undefined && ch.enabled !== filter.enabled) continue;
      if (filter.hidden !== undefined && ch.hidden !== filter.hidden) continue;
      if (filter.group && ch.group !== filter.group) continue;
      if (filter.country && ch.country !== filter.country) continue;
      if (filter.language && ch.language !== filter.language) continue;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (!ch.name.toLowerCase().includes(q) && !ch.group.toLowerCase().includes(q)) continue;
      }
      if (filter.state && ch.state !== filter.state) continue;
      // Source binding filters (used by SourceRepository.importChannels)
      if (filter.primarySource !== undefined && ch.primarySource !== filter.primarySource) continue;
      if (filter.primaryStreamId !== undefined && ch.primaryStreamId !== filter.primaryStreamId) continue;
      
      result.push({ ...ch });
    }
    return result;
  }
  
  getChannelCount(filter = {}) {
    return this.getChannels(filter).length;
  }
  
  getChannelsByGroup() {
    const groups = new Map();
    for (const [, ch] of this._channels) {
      if (!ch.enabled) continue;
      const g = ch.group || 'Uncategorized';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(ch);
    }
    return groups;
  }
  
  removeChannel(channelId) {
    this._channels.delete(channelId);
    this._streams.delete(channelId);
    this._health.delete(channelId);
    this._bump();
    this.emit('channel:removed', { channelId });
  }
  
  // ── Sources ────────────────────────────────────────────────
  
  setSource(sourceId, data) {
    let entry = this._sources.get(sourceId);
    const isNew = !entry;
    
    if (!entry) {
      entry = {
        id: sourceId,
        name: '',
        description: '',
        enabled: true,
        priority: 0,
        weight: 100,
        type: 'm3u',  // m3u, xtream, stalker, mag, json, csv, zip
        baseUrl: '',
        username: '',
        password: '',
        mac: '',
        portal: '',
        referer: '',
        origin: '',
        userAgent: '',
        cookie: '',
        headers: {},
        proxy: '',
        dns: '',
        autoSync: false,
        syncInterval: 3600,
        // Statistics
        status: 'unknown',
        healthScore: null,
        latency: 0,
        lastSync: null,
        totalChannels: 0,
        failedChannels: 0,
        errorCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this._sources.set(sourceId, entry);
    }
    
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        entry[k] = v;
      }
    }
    entry.updatedAt = Date.now();
    this._bump();
    
    if (isNew) {
      this.emit('source:created', { sourceId, source: entry });
    }
    this.emit('source:updated', { sourceId });
    
    return entry;
  }
  
  getSource(sourceId) {
    return this._sources.get(sourceId) || null;
  }
  
  getSources(filter = {}) {
    const result = [];
    for (const [, src] of this._sources) {
      if (filter.enabled !== undefined && src.enabled !== filter.enabled) continue;
      if (filter.type && src.type !== filter.type) continue;
      result.push({ ...src });
    }
    return result;
  }
  
  removeSource(sourceId) {
    this._sources.delete(sourceId);
    this._bump();
    this.emit('source:removed', { sourceId });
  }
  
  // ── Streams (Runtime state only) ──────────────────────────
  
  setStream(channelId, data) {
    let entry = this._streams.get(channelId);
    if (!entry) {
      entry = {
        channelId,
        state: 'STOPPED',
        prevState: null,
        pid: null,
        cpu: 0,
        memory: 0,
        currentUrl: '',
        currentUrlIndex: 0,
        viewers: 0,
        reconnectCount: 0,
        startedAt: null,
        uptime: 0,
        lastStateChange: Date.now(),
        error: null
      };
      this._streams.set(channelId, entry);
    }
    
    let stateChanged = false;
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      if (k === 'state' && v !== entry.state) {
        entry.prevState = entry.state;
        entry.state = v;
        entry.lastStateChange = Date.now();
        stateChanged = true;
      } else {
        entry[k] = v;
      }
    }
    
    this._bump();
    
    if (stateChanged) {
      this.emit('stream:state', {
        channelId,
        state: entry.state,
        prevState: entry.prevState,
        viewers: entry.viewers
      });
    }
    
    // Also update the channel entry's runtime state
    const ch = this._channels.get(channelId);
    if (ch) {
      ch.state = entry.state;
      ch.pid = entry.pid;
      ch.viewerCount = entry.viewers;
      ch.currentUrl = entry.currentUrl;
      ch.currentUrlIndex = entry.currentUrlIndex;
      ch.reconnectCount = entry.reconnectCount;
      ch.startedAt = entry.startedAt;
      ch.uptime = entry.uptime;
    }
    
    return entry;
  }
  
  getStream(channelId) {
    return this._streams.get(channelId) || null;
  }
  
  getStreams(filter = {}) {
    const result = [];
    for (const [, st] of this._streams) {
      if (filter.state && st.state !== filter.state) continue;
      result.push({ ...st });
    }
    return result;
  }
  
  // ── Viewers ────────────────────────────────────────────────
  
  setViewer(viewerId, data) {
    let entry = this._viewers.get(viewerId);
    const isNew = !entry;
    
    if (!entry) {
      entry = {
        id: viewerId,
        ip: '',
        country: '',
        city: '',
        isp: '',
        device: '',
        browser: '',
        os: '',
        platform: '',
        userAgent: '',
        currentChannel: '',
        status: 'connected',
        bandwidth: 0,
        bitrate: 0,
        latency: 0,
        packetLoss: 0,
        startTime: Date.now(),
        watchTime: 0,
        lastHeartbeat: Date.now(),
        reconnectCount: 0,
        bufferEvents: 0,
        segmentsLoaded: 0,
        segmentsFailed: 0,
        kicked: false,
        banned: false
      };
      this._viewers.set(viewerId, entry);
      this.emit('viewer:connected', { viewerId, viewer: entry });
    }
    
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      if (k === 'watchTime') entry.watchTime = typeof v === 'number' ? v : entry.watchTime;
      else if (k === 'bandwidth') entry.bandwidth = typeof v === 'number' ? v : entry.bandwidth;
      else if (k === 'bitrate') entry.bitrate = typeof v === 'number' ? v : entry.bitrate;
      else if (k === 'latency') entry.latency = typeof v === 'number' ? v : entry.latency;
      else if (k === 'packetLoss') entry.packetLoss = typeof v === 'number' ? v : entry.packetLoss;
      else if (k === 'reconnectCount') entry.reconnectCount = typeof v === 'number' ? v : entry.reconnectCount;
      else if (k === 'bufferEvents') entry.bufferEvents = typeof v === 'number' ? v + (entry.bufferEvents || 0) : entry.bufferEvents;
      else if (k === 'lastHeartbeat') entry.lastHeartbeat = v;
      else if (k === 'status') entry.status = v;
      else entry[k] = v;
    }
    
    this._bump();
    this.emit('viewer:updated', { viewerId });
    return entry;
  }
  
  getViewer(viewerId) {
    return this._viewers.get(viewerId) || null;
  }
  
  getViewers(filter = {}) {
    const result = [];
    for (const [, v] of this._viewers) {
      if (filter.channelId && v.currentChannel !== filter.channelId) continue;
      if (filter.status && v.status !== filter.status) continue;
      if (filter.kicked !== undefined && v.kicked !== filter.kicked) continue;
      if (filter.banned !== undefined && v.banned !== filter.banned) continue;
      result.push({ ...v });
    }
    return result;
  }
  
  getViewerCount(channelId) {
    let count = 0;
    for (const [, v] of this._viewers) {
      if (v.currentChannel === channelId && v.status === 'connected') count++;
    }
    return count;
  }
  
  getTotalViewers() {
    let count = 0;
    for (const [, v] of this._viewers) {
      if (v.status === 'connected') count++;
    }
    return count;
  }
  
  getViewerDistribution() {
    const devices = new Map();
    const browsers = new Map();
    const countries = new Map();
    const platforms = new Map();
    
    for (const [, v] of this._viewers) {
      if (v.status !== 'connected') continue;
      devices.set(v.device || 'Unknown', (devices.get(v.device || 'Unknown') || 0) + 1);
      browsers.set(v.browser || 'Unknown', (browsers.get(v.browser || 'Unknown') || 0) + 1);
      countries.set(v.country || 'Unknown', (countries.get(v.country || 'Unknown') || 0) + 1);
      platforms.set(v.platform || 'Unknown', (platforms.get(v.platform || 'Unknown') || 0) + 1);
    }
    
    return {
      devices: Object.fromEntries(devices),
      browsers: Object.fromEntries(browsers),
      countries: Object.fromEntries(countries),
      platforms: Object.fromEntries(platforms)
    };
  }
  
  removeViewer(viewerId) {
    const viewer = this._viewers.get(viewerId);
    this._viewers.delete(viewerId);
    this._bump();
    this.emit('viewer:disconnected', { viewerId, viewer });
  }

  // ── Stream Removal ─────────────────────────────────────────

  removeStream(channelId) {
    this._streams.delete(channelId);
    this._bump();
    this.emit('stream:removed', { channelId });
  }
  
  // ── Health ─────────────────────────────────────────────────
  
  setHealth(channelId, data) {
    let entry = this._health.get(channelId);
    const isNew = !entry;
    
    if (!entry) {
      entry = {
        channelId,
        score: 100,
        latency: 0,
        packetLoss: 0,
        segmentDelay: 0,
        bitrateStability: 100,
        droppedFrames: 0,
        decodeErrors: 0,
        audioErrors: 0,
        reconnectCount: 0,
        bufferingCount: 0,
        bitrate: 0,
        resolution: '',
        codec: '',
        fps: null,
        uptime: 0,
        totalStreamTime: 0,
        segmentCount: 0,
        mediaSequence: 0,
        updatedAt: Date.now()
      };
      this._health.set(channelId, entry);
    }
    
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        entry[k] = v;
      }
    }
    entry.updatedAt = Date.now();
    this._bump();
    this.emit('health:updated', { channelId, score: entry.score, latency: entry.latency });
    
    // Sync health score to channel entry
    const ch = this._channels.get(channelId);
    if (ch) ch.healthScore = entry.score;
    
    return entry;
  }
  
  getHealth(channelId) {
    return this._health.get(channelId) || null;
  }
  
  getHealthSummary() {
    let healthy = 0, warning = 0, critical = 0, offline = 0;
    let totalScore = 0, count = 0;
    
    for (const [, h] of this._health) {
      totalScore += h.score;
      count++;
      if (h.score >= 80) healthy++;
      else if (h.score >= 50) warning++;
      else if (h.score > 0) critical++;
      else offline++;
    }
    
    // Add channels with no health data as offline
    for (const [, ch] of this._channels) {
      if (!this._health.has(ch.id)) {
        offline++;
      }
    }
    
    return {
      averageScore: count > 0 ? Math.round(totalScore / count) : 100,
      healthy,
      warning,
      critical,
      offline,
      total: count + offline
    };
  }
  
  // ── Cache ──────────────────────────────────────────────────
  
  _resetCacheStats() {
    this._cache = {
      ramHits: 0,
      ramMisses: 0,
      diskHits: 0,
      diskMisses: 0,
      ramUsedBytes: 0,
      ramCapacityBytes: 268435456,  // 256MB default
      diskUsedBytes: 0,
      diskCapacityBytes: 5368709120, // 5GB default
      segmentCount: 0,
      playlistCount: 0,
      metadataCount: 0,
      manifestCount: 0,
      hitRate: 100,
      missRate: 0,
      readSpeed: 0,
      writeSpeed: 0,
      lastUpdated: Date.now()
    };
  }
  
  setCacheStats(stats) {
    for (const [k, v] of Object.entries(stats)) {
      if (v !== undefined && v !== null && k in this._cache) {
        this._cache[k] = v;
      }
    }
    // Calculate rates
    const total = this._cache.ramHits + this._cache.ramMisses + this._cache.diskHits + this._cache.diskMisses;
    this._cache.hitRate = total > 0 ? Math.round(((this._cache.ramHits + this._cache.diskHits) / total) * 100) : 100;
    this._cache.missRate = 100 - this._cache.hitRate;
    this._cache.lastUpdated = Date.now();
    this._bump();
    this.emit('cache:stats', { ...this._cache });
  }
  
  getCacheStats() {
    return { ...this._cache };
  }
  
  // ── System Stats ───────────────────────────────────────────
  
  _resetSystemStats() {
    this._system = {
      cpuPercent: 0,
      memoryRssMb: 0,
      memoryHeapMb: 0,
      memoryExternalMb: 0,
      memoryArrayBuffersMb: 0,
      uptimeSeconds: 0,
      startTime: Date.now(),
      lastUpdated: Date.now(),
      loadAverage: [0, 0, 0],
      activeHandles: 0,
      activeRequests: 0
    };
  }
  
  getSystemStats() {
    return { ...this._system };
  }
  
  _pollSystem() {
    const usage = process.memoryUsage();
    const now = Date.now();
    
    this._system.cpuPercent = 0;  // Would need os.cpuUsage() on Windows
    this._system.memoryRssMb = Math.round((usage.rss / 1024 / 1024) * 100) / 100;
    this._system.memoryHeapMb = Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
    this._system.memoryExternalMb = Math.round((usage.external / 1024 / 1024) * 100) / 100;
    this._system.memoryArrayBuffersMb = Math.round(((usage.arrayBuffers || 0) / 1024 / 1024) * 100) / 100;
    this._system.uptimeSeconds = Math.floor((now - this._system.startTime) / 1000);
    this._system.lastUpdated = now;
    
    this._bump();
    this.emit('system:stats', { ...this._system });
  }
  
  // ── Dashboard Aggregation ─────────────────────────────────
  
  /**
   * Build a complete dashboard snapshot from the registry.
   */
  getDashboard() {
    const channels = this.getChannels();
    const streams = this.getStreams();
    
    const channelStats = {
      total: channels.length,
      enabled: channels.filter(c => c.enabled).length,
      running: streams.filter(s => s.state === 'ONLINE').length,
      starting: streams.filter(s => s.state === 'STARTING' || s.state === 'PROBING' || s.state === 'BUFFERING').length,
      error: streams.filter(s => s.state === 'ERROR').length,
      idle: streams.filter(s => s.state === 'IDLE' || s.state === 'STOPPED').length,
      reconnecting: streams.filter(s => s.state === 'RECONNECTING').length
    };
    
    const viewers = this.getViewers();
    const viewerStats = {
      current: viewers.filter(v => v.status === 'connected').length,
      total: viewers.length,
      peak: Math.max(...viewers.filter(v => v.status === 'connected').map(v => v.watchTime)) || 0
    };
    
    return {
      version: this._version,
      system: this.getSystemStats(),
      channels: channelStats,
      viewers: viewerStats,
      viewerDistribution: this.getViewerDistribution(),
      health: this.getHealthSummary(),
      cache: this.getCacheStats(),
      sources: {
        total: this._sources.size,
        enabled: this.getSources({ enabled: true }).length
      },
      streams: streams.map(s => ({
        channelId: s.channelId,
        state: s.state,
        viewers: s.viewers,
        pid: s.pid,
        cpu: s.cpu,
        memory: s.memory,
        uptime: s.uptime,
        reconnectCount: s.reconnectCount
      })),
      healthDetails: Array.from(this._health.values()).map(h => ({
        channelId: h.channelId,
        score: h.score,
        latency: h.latency,
        bitrate: h.bitrate,
        resolution: h.resolution,
        codec: h.codec
      })),
      logs: this.getLogs(20)
    };
  }
  
  // ── Shutdown ──────────────────────────────────────────────
  
  shutdown() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._events.removeAllListeners();
    this._channels.clear();
    this._sources.clear();
    this._streams.clear();
    this._viewers.clear();
    this._health.clear();
    this._logs = [];
  }
}

module.exports = new RuntimeRegistry();