'use strict';

/**
 * Mubasher Core v2.0 - Channel Repository (UPDATED)
 * ===================================================
 * Responsible ONLY for channel metadata persistence.
 * No runtime state here - that goes to RuntimeRegistry.
 * 
 * Architecture:
 *   - Load channels from storage on startup
 *   - CRUD operations for channel metadata
 *   - All runtime state goes to RuntimeRegistry
 *   - Supports direct URLs with headers (no Source needed)
 *   - Supports Source references (primarySource + primaryStreamId)
 *   - Supports backup sources for failover
 */

const storage = require('../storage');
const runtime = require('../runtime');
const logger = require('../logger');
const { v4: uuidv4 } = require('uuid');

class ChannelRepository {
  constructor() {
    this._loaded = false;
  }

  /**
   * Load all channels from storage and register them in RuntimeRegistry.
   */
  async load() {
    if (this._loaded) return;
    
    try {
      const data = storage.getAll('channels') || [];
      let count = 0;
      
      for (const ch of data) {
        const id = ch.id || uuidv4();
        runtime.setChannel(id, {
          ...ch,
          id
        });
        count++;
      }
      
      logger.info(`ChannelRepository: loaded ${count} channels`);
      this._loaded = true;
    } catch (err) {
      logger.error('ChannelRepository: load failed', { error: err.message });
    }
  }

  /**
   * Save all channels to storage.
   */
  _save() {
    try {
      const channels = runtime.getChannels();
      const metadata = channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        number: ch.number,
        group: ch.group,
        logo: ch.logo,
        epgId: ch.epgId,
        tvgId: ch.tvgId,
        language: ch.language,
        country: ch.country,
        enabled: ch.enabled,
        hidden: ch.hidden,
        favorite: ch.favorite,
        adult: ch.adult,
        locked: ch.locked,
        archive: ch.archive,
        priority: ch.priority,
        // Source references
        primarySource: ch.primarySource,
        primaryStreamId: ch.primaryStreamId,
        backupSource1: ch.backupSource1,
        backupStreamId1: ch.backupStreamId1,
        backupSource2: ch.backupSource2,
        backupStreamId2: ch.backupStreamId2,
        backupSource3: ch.backupSource3,
        backupStreamId3: ch.backupStreamId3,
        // Direct URL support (no Source needed)
        url: ch.url,
        referer: ch.referer,
        origin: ch.origin,
        userAgent: ch.userAgent,
        cookie: ch.cookie,
        headers: ch.headers,
        proxy: ch.proxy,
        dns: ch.dns,
        // Streaming settings
        viewerLimit: ch.viewerLimit,
        idleTimeout: ch.idleTimeout,
        bufferSize: ch.bufferSize,
        reconnectAttempts: ch.reconnectAttempts,
        segmentDuration: ch.segmentDuration,
        playlistSize: ch.playlistSize,
        deleteThreshold: ch.deleteThreshold,
        diskCacheSize: ch.diskCacheSize,
        ramCacheSize: ch.ramCacheSize,
        ffmpegProfile: ch.ffmpegProfile,
        hardwareDecode: ch.hardwareDecode,
        hardwareEncode: ch.hardwareEncode,
        videoCodec: ch.videoCodec,
        audioCodec: ch.audioCodec,
        bitrate: ch.bitrate,
        resolution: ch.resolution,
        fps: ch.fps,
        customFfmpegArgs: ch.customFfmpegArgs
      }));
      
      storage.setAll('channels', metadata);
    } catch (err) {
      logger.error('ChannelRepository: save failed', { error: err.message });
    }
  }

  /**
   * Add a new channel.
   */
  add(data) {
    const id = uuidv4();
    const channel = runtime.setChannel(id, {
      id,
      name: data.name || 'New Channel',
      number: data.number || 0,
      group: data.group || '',
      logo: data.logo || '',
      epgId: data.epgId || '',
      tvgId: data.tvgId || '',
      language: data.language || '',
      country: data.country || '',
      enabled: data.enabled !== false,
      hidden: data.hidden || false,
      favorite: data.favorite || false,
      adult: data.adult || false,
      locked: data.locked || false,
      archive: data.archive || false,
      priority: data.priority || 0,
      // Source references
      primarySource: data.primarySource || null,
      primaryStreamId: data.primaryStreamId || null,
      backupSource1: data.backupSource1 || null,
      backupStreamId1: data.backupStreamId1 || null,
      backupSource2: data.backupSource2 || null,
      backupStreamId2: data.backupStreamId2 || null,
      backupSource3: data.backupSource3 || null,
      backupStreamId3: data.backupStreamId3 || null,
      // Direct URL support
      url: data.url || '',
      referer: data.referer || '',
      origin: data.origin || '',
      userAgent: data.userAgent || '',
      cookie: data.cookie || '',
      headers: data.headers || {},
      proxy: data.proxy || '',
      dns: data.dns || '',
      // Streaming settings
      viewerLimit: data.viewerLimit || 0,
      idleTimeout: data.idleTimeout || 30,
      bufferSize: data.bufferSize || 4096,
      reconnectAttempts: data.reconnectAttempts || 10,
      segmentDuration: data.segmentDuration || 2,
      playlistSize: data.playlistSize || 10,
      deleteThreshold: data.deleteThreshold || 4,
      diskCacheSize: data.diskCacheSize || 5120,
      ramCacheSize: data.ramCacheSize || 256,
      ffmpegProfile: data.ffmpegProfile || 'default',
      hardwareDecode: data.hardwareDecode || false,
      hardwareEncode: data.hardwareEncode || false,
      videoCodec: data.videoCodec || 'copy',
      audioCodec: data.audioCodec || 'copy',
      bitrate: data.bitrate || 0,
      resolution: data.resolution || '',
      fps: data.fps || null,
      customFfmpegArgs: data.customFfmpegArgs || ''
    });
    
    this._save();
    logger.info(`ChannelRepository: added channel "${channel.name}" (${id})`);
    return runtime.getChannel(id);
  }

  /**
   * Update a channel's metadata.
   */
  update(id, data) {
    const existing = runtime.getChannel(id);
    if (!existing) return null;
    
    runtime.setChannel(id, data);
    this._save();
    
    const updated = runtime.getChannel(id);
    logger.info(`ChannelRepository: updated channel "${updated.name}" (${id})`);
    return updated;
  }

  /**
   * Remove a channel.
   */
  remove(id) {
    const channel = runtime.getChannel(id);
    if (!channel) return false;
    
    runtime.removeChannel(id);
    this._save();
    logger.info(`ChannelRepository: removed channel "${channel.name}" (${id})`);
    return true;
  }

  /**
   * Get all channels (wraps runtime.getChannels).
   */
  getAll(filter = {}) {
    return runtime.getChannels(filter);
  }

  /**
   * Get a single channel.
   */
  getById(id) {
    return runtime.getChannel(id);
  }

  /**
   * Get channel groups.
   */
  getGroups() {
    const groups = new Set();
    for (const ch of runtime.getChannels({ enabled: true })) {
      if (ch.group) groups.add(ch.group);
    }
    return ['All', ...Array.from(groups).sort()];
  }

  /**
   * Bulk operations.
   */
  bulkEnable(ids) {
    let count = 0;
    for (const id of ids) {
      if (runtime.getChannel(id)) {
        runtime.setChannel(id, { enabled: true });
        count++;
      }
    }
    this._save();
    return count;
  }

  bulkDisable(ids) {
    let count = 0;
    for (const id of ids) {
      if (runtime.getChannel(id)) {
        runtime.setChannel(id, { enabled: false });
        count++;
      }
    }
    this._save();
    return count;
  }

  bulkDelete(ids) {
    let count = 0;
    for (const id of ids) {
      if (runtime.getChannel(id)) {
        runtime.removeChannel(id);
        count++;
      }
    }
    this._save();
    return count;
  }

  bulkMoveGroup(ids, group) {
    let count = 0;
    for (const id of ids) {
      if (runtime.getChannel(id)) {
        runtime.setChannel(id, { group });
        count++;
      }
    }
    this._save();
    return count;
  }

  bulkUpdate(ids, data) {
    let count = 0;
    for (const id of ids) {
      if (runtime.getChannel(id)) {
        runtime.setChannel(id, data);
        count++;
      }
    }
    this._save();
    return count;
  }

  /**
   * Get the stream URL for a channel by resolving source references.
   * Supports both Source references and direct URLs.
   */
  getStreamUrl(channelId, sourcesRepo) {
    const ch = runtime.getChannel(channelId);
    if (!ch || !ch.enabled) return null;

    // Get current stream state to know which source we're using
    const stream = runtime.getStream(channelId);
    const currentIndex = stream ? stream.currentUrlIndex : 0;

    // Build ordered list of sources
    const sourceRefs = [
      { sourceId: ch.primarySource, streamId: ch.primaryStreamId },
      { sourceId: ch.backupSource1, streamId: ch.backupStreamId1 },
      { sourceId: ch.backupSource2, streamId: ch.backupStreamId2 },
      { sourceId: ch.backupSource3, streamId: ch.backupStreamId3 }
    ].filter(ref => ref.sourceId && ref.streamId);

    // If no source references but has direct URL, use that
    if (sourceRefs.length === 0 && ch.url) {
      return {
        url: ch.url,
        sourceId: null,
        streamId: null,
        index: 0,
        referer: ch.referer,
        origin: ch.origin,
        userAgent: ch.userAgent,
        cookie: ch.cookie,
        headers: ch.headers,
        proxy: ch.proxy,
        dns: ch.dns
      };
    }

    if (sourceRefs.length === 0) return null;

    // Try from current index, then rotate
    for (let i = 0; i < sourceRefs.length; i++) {
      const idx = (currentIndex + i) % sourceRefs.length;
      const ref = sourceRefs[idx];
      
      let url = null;
      if (sourcesRepo) {
        url = sourcesRepo.resolveStreamUrl(ref.sourceId, ref.streamId);
      }
      
      // Fallback: treat streamId as direct URL
      if (!url && ref.streamId) {
        url = ref.streamId;
      }
      
      if (url) {
        // Get source info for proxy headers
        const sourceObj = ref.sourceId && sourcesRepo ? sourcesRepo.getById(ref.sourceId) : null;
        return {
          url,
          sourceId: ref.sourceId,
          streamId: ref.streamId,
          index: idx,
          referer: sourceObj ? sourceObj.referer : '',
          origin: sourceObj ? sourceObj.origin : '',
          userAgent: sourceObj ? sourceObj.userAgent : '',
          cookie: sourceObj ? sourceObj.cookie : '',
          headers: sourceObj ? sourceObj.headers : {},
          proxy: sourceObj ? sourceObj.proxy : '',
          dns: sourceObj ? sourceObj.dns : ''
        };
      }
    }

    return null;
  }

  /**
   * Get all channels that should be streamed (enabled and have sources).
   */
  getStreamableChannels(sourcesRepo) {
    const result = [];
    for (const ch of runtime.getChannels({ enabled: true })) {
      const url = this.getStreamUrl(ch.id, sourcesRepo);
      if (url) {
        result.push({ channel: ch, ...url });
      }
    }
    return result;
  }
}

module.exports = new ChannelRepository();