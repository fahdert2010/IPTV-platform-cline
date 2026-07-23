'use strict';

/**
 * Mubasher Core v2.0 - Source Repository (UPDATED)
 * ==================================================
 * Manages IPTV sources with full type support:
 *   M3U File, Remote M3U URL, Direct HLS (.m3u8), Direct TS,
 *   MPD (DASH), MP4, RTMP, RTSP, UDP, SRT, RIST,
 *   Xtream Codes, Stalker, MAG, JSON, CSV, ZIP,
 *   Local Media (Video / Movie / Series / Folder / SMB / NFS)
 * 
 * All state stored in RuntimeRegistry.
 * No URLs stored in channels - only source + stream ID references.
 */

const storage = require('../storage');
const runtime = require('../runtime');
const logger = require('../logger');
const { v4: uuidv4 } = require('uuid');
const m3uParser = require('./m3u-parser');
const fs = require('fs');
const path = require('path');

class SourceRepository {
  constructor() {
    this._loaded = false;
    this._streamUrls = new Map(); // sourceId:streamId → resolved URL
  }

  async load() {
    if (this._loaded) return;
    try {
      const data = storage.getAll('sources') || [];
      let count = 0;
      for (const src of data) {
        const id = src.id || uuidv4();
        runtime.setSource(id, { ...src, id });
        count++;
      }
      logger.info(`SourceRepository: loaded ${count} sources`);
      this._loaded = true;
    } catch (err) {
      logger.error('SourceRepository: load failed', { error: err.message });
    }
  }

  _save() {
    try {
      const sources = runtime.getSources();
      const metadata = sources.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        priority: s.priority,
        weight: s.weight,
        type: s.type,
        baseUrl: s.baseUrl,
        username: s.username,
        password: s.password,
        mac: s.mac,
        portal: s.portal,
        referer: s.referer,
        origin: s.origin,
        userAgent: s.userAgent,
        cookie: s.cookie,
        headers: s.headers,
        proxy: s.proxy,
        dns: s.dns,
        autoSync: s.autoSync,
        syncInterval: s.syncInterval
      }));
      storage.setAll('sources', metadata);
    } catch (err) {
      logger.error('SourceRepository: save failed', { error: err.message });
    }
  }

  add(data) {
    const id = uuidv4();
    runtime.setSource(id, {
      id,
      name: data.name || 'New Source',
      description: data.description || '',
      enabled: data.enabled !== false,
      priority: data.priority || 0,
      weight: data.weight || 100,
      type: data.type || 'm3u',
      baseUrl: data.baseUrl || '',
      username: data.username || '',
      password: data.password || '',
      mac: data.mac || '',
      portal: data.portal || '',
      referer: data.referer || '',
      origin: data.origin || '',
      userAgent: data.userAgent || '',
      cookie: data.cookie || '',
      headers: data.headers || {},
      proxy: data.proxy || '',
      dns: data.dns || '',
      autoSync: data.autoSync || false,
      syncInterval: data.syncInterval || 3600
    });
    this._save();
    logger.info(`SourceRepository: added source "${data.name}" (${id})`);
    return runtime.getSource(id);
  }

  update(id, data) {
    const existing = runtime.getSource(id);
    if (!existing) return null;
    runtime.setSource(id, data);
    this._save();
    return runtime.getSource(id);
  }

  remove(id) {
    const src = runtime.getSource(id);
    if (!src) return false;
    runtime.removeSource(id);
    this._save();
    logger.info(`SourceRepository: removed source "${src.name}" (${id})`);
    return true;
  }

  getById(id) {
    return runtime.getSource(id);
  }

  getAll(filter = {}) {
    return runtime.getSources(filter);
  }

  /**
   * Resolve a stream URL from sourceId + streamId.
   * Supports ALL source types:
   *   m3u, xtream, stalker, mag, json, csv, zip,
   *   hls, ts, mpd, mp4, rtmp, rtsp, udp, srt, rist,
   *   local, smb, nfs
   */
  resolveStreamUrl(sourceId, streamId) {
    const cached = this._streamUrls.get(`${sourceId}:${streamId}`);
    if (cached) return cached;

    const source = runtime.getSource(sourceId);
    if (!source || !source.enabled) return null;

    let url = null;
    switch (source.type) {
      case 'm3u':
      case 'm3u_file':
        // streamId is the raw URL from M3U playlist
        url = streamId;
        break;

      case 'xtream':
        // Xtream API: http://domain:port/LIVE/username/password/streamId.m3u8
        url = `${source.baseUrl}/LIVE/${source.username}/${source.password}/${streamId}.m3u8`;
        break;

      case 'stalker':
        // Stalker Portal: http://domain/stalker_portal/stream/streamId
        url = `${source.baseUrl}/stalker_portal/stream/${streamId}`;
        break;

      case 'mag':
        // MAG: http://domain/c/streamId
        url = `${source.baseUrl}/c/${streamId}`;
        break;

      case 'hls':
        // Direct HLS (.m3u8) - streamId is the full URL or relative path
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'ts':
        // Direct TS stream
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'mpd':
        // DASH MPD manifest
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'mp4':
        // Direct MP4 file
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'rtmp':
        // RTMP stream
        url = streamId.startsWith('rtmp') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'rtsp':
        // RTSP stream
        url = streamId.startsWith('rtsp') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'udp':
        // UDP multicast
        url = streamId.startsWith('udp') ? streamId : `udp://${source.baseUrl}:${streamId}`;
        break;

      case 'srt':
        // SRT stream
        url = streamId.startsWith('srt') ? streamId : `srt://${source.baseUrl}:${streamId}`;
        break;

      case 'rist':
        // RIST stream
        url = streamId.startsWith('rist') ? streamId : `rist://${source.baseUrl}:${streamId}`;
        break;

      case 'json':
        // JSON API - streamId is the endpoint
        url = `${source.baseUrl}/${streamId}`;
        break;

      case 'csv':
        // CSV file - streamId is the file path
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'zip':
        // ZIP archive - streamId is the file path
        url = streamId.startsWith('http') ? streamId : `${source.baseUrl}/${streamId}`;
        break;

      case 'local':
        // Local media file
        url = streamId;
        break;

      case 'smb':
        // SMB share
        url = `smb://${source.username ? source.username + '@' : ''}${source.baseUrl}/${streamId}`;
        break;

      case 'nfs':
        // NFS share
        url = `nfs://${source.baseUrl}/${streamId}`;
        break;

      default:
        // Fallback: treat streamId as direct URL
        url = streamId;
    }

    if (url) {
      this._streamUrls.set(`${sourceId}:${streamId}`, url);
    }
    return url;
  }

  /**
   * Import channels from a source.
   * Supports: m3u, xtream, stalker, mag, json, csv, zip, local
   */
  async importChannels(source) {
    const src = source || runtime.getSource(source);
    if (!src) return { success: false, error: 'Source not found' };

    try {
      let channels = [];
      
      switch (src.type) {
        case 'm3u':
        case 'm3u_file':
          channels = await this._importM3U(src);
          break;
        case 'xtream':
          channels = await this._importXtream(src);
          break;
        case 'stalker':
          channels = await this._importStalker(src);
          break;
        case 'mag':
          channels = await this._importMAG(src);
          break;
        case 'json':
          channels = await this._importJSON(src);
          break;
        case 'csv':
          channels = await this._importCSV(src);
          break;
        case 'zip':
          channels = await this._importZIP(src);
          break;
        case 'local':
          channels = await this._importLocal(src);
          break;
        case 'hls':
        case 'ts':
        case 'mpd':
        case 'mp4':
        case 'rtmp':
        case 'rtsp':
        case 'udp':
        case 'srt':
        case 'rist':
          // Direct stream types - create a single channel
          channels = [{
            name: src.name || 'Direct Stream',
            streamId: src.baseUrl,
            group: 'Direct',
            logo: '',
            language: '',
            country: '',
            bitrate: 0,
            resolution: '',
            fps: null,
            number: 0
          }];
          break;
        default:
          return { success: false, error: `Unsupported source type: ${src.type}` };
      }

      // Register channels in RuntimeRegistry via Channel Repository
      const channelsRepo = require('../channels');
      let added = 0, updated = 0, failed = 0;

      for (const ch of channels) {
        try {
          // Check if channel already exists by stream ID
          const existing = runtime.getChannels({
            primaryStreamId: ch.streamId,
            primarySource: src.id
          });

          if (existing.length > 0) {
            // Update existing channel
            channelsRepo.update(existing[0].id, {
              name: ch.name,
              number: ch.number,
              group: ch.group,
              logo: ch.logo,
              language: ch.language,
              country: ch.country,
              bitrate: ch.bitrate,
              resolution: ch.resolution,
              fps: ch.fps,
              enabled: true
            });
            updated++;
          } else {
            // Add new channel
            channelsRepo.add({
              name: ch.name,
              number: ch.number || 0,
              group: ch.group || '',
              logo: ch.logo || '',
              language: ch.language || '',
              country: ch.country || '',
              primarySource: src.id,
              primaryStreamId: ch.streamId,
              enabled: true
            });
            added++;
          }
        } catch (err) {
          failed++;
          logger.error(`SourceRepository: failed to import channel "${ch.name}": ${err.message}`);
        }
      }

      // Update source statistics
      runtime.setSource(src.id, {
        status: 'healthy',
        lastSync: Date.now(),
        totalChannels: added + updated,
        failedChannels: failed
      });

      this._save();

      return {
        success: true,
        added,
        updated,
        failed,
        total: channels.length
      };
    } catch (err) {
      runtime.setSource(src.id, { status: 'error', errorCount: (src.errorCount || 0) + 1 });
      logger.error(`SourceRepository: import failed for "${src.name}": ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async _importM3U(source) {
    let content;

    if (source.baseUrl && source.baseUrl.startsWith('http')) {
      // Fetch from URL
      const response = await fetch(source.baseUrl, {
        headers: {
          'User-Agent': source.userAgent || 'Mozilla/5.0',
          'Referer': source.referer || '',
          'Origin': source.origin || '',
          'Cookie': source.cookie || '',
          ...source.headers
        }
      });
      content = await response.text();
    } else if (source.baseUrl && fs.existsSync(source.baseUrl)) {
      // Read from file
      content = fs.readFileSync(source.baseUrl, 'utf8');
    } else {
      throw new Error('No valid source URL or file path');
    }

    const parsed = m3uParser.parseM3U(content);
    return parsed.map(item => ({
      name: item.name,
      streamId: item.url, // Store raw URL as streamId for M3U
      url: item.url,
      group: item.group,
      logo: item.logo,
      language: item.language || '',
      country: item.country || '',
      bitrate: item.bitrate || 0,
      resolution: item.resolution || '',
      fps: item.fps || null,
      number: item.tvgId ? parseInt(item.tvgId) : 0
    }));
  }

  async _importXtream(source) {
    // Fetch channels from Xtream API
    const baseUrl = source.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/player_api.php?username=${source.username}&password=${source.password}&action=get_live_streams`);
    const data = await response.json();

    if (!data || !Array.isArray(data)) {
      throw new Error('Invalid Xtream API response');
    }

    return data.map(item => ({
      name: item.name,
      streamId: item.stream_id.toString(),
      group: item.category_name || '',
      logo: item.stream_icon || '',
      language: '',
      country: '',
      bitrate: parseInt(item.bitrate) || 0,
      resolution: `${item.width}x${item.height}` || '',
      fps: null,
      number: item.num || 0
    }));
  }

  async _importStalker(source) {
    // Stalker Portal API
    const baseUrl = source.baseUrl.replace(/\/+$/, '');
    const mac = source.mac || '00:1A:79:00:00:00';
    
    // Stalker handshake
    const handshake = await fetch(`${baseUrl}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U)',
        'Cookie': `mac=${mac}`
      }
    });
    const handshakeData = await handshake.json();
    
    if (!handshakeData || handshakeData.js && handshakeData.js.token) {
      const token = handshakeData.js.token;
      
      // Get channels
      const channelsRes = await fetch(`${baseUrl}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U)',
          'Cookie': `mac=${mac}; token=${token}`
        }
      });
      const channelsData = await channelsRes.json();
      
      if (channelsData && channelsData.js && Array.isArray(channelsData.js.data)) {
        return channelsData.js.data.map(item => ({
          name: item.name,
          streamId: item.id,
          group: item.tv_genre_name || '',
          logo: item.logo || '',
          language: item.languages || '',
          country: '',
          bitrate: 0,
          resolution: '',
          fps: null,
          number: parseInt(item.number) || 0
        }));
      }
    }
    
    throw new Error('Stalker authentication failed');
  }

  async _importMAG(source) {
    // MAG Portal - similar to Stalker
    const baseUrl = source.baseUrl.replace(/\/+$/, '');
    const mac = source.mac || '00:1A:79:00:00:00';
    
    const response = await fetch(`${baseUrl}/c/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U)',
        'Cookie': `mac=${mac}`
      }
    });
    
    // MAG typically uses the same API as Stalker
    return this._importStalker(source);
  }

  async _importJSON(source) {
    // JSON API source
    const response = await fetch(source.baseUrl, {
      headers: {
        'User-Agent': source.userAgent || 'Mozilla/5.0',
        'Referer': source.referer || '',
        'Origin': source.origin || '',
        'Cookie': source.cookie || '',
        ...source.headers
      }
    });
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('JSON source must return an array of channels');
    }
    
    return data.map(item => ({
      name: item.name || item.title || item.channel,
      streamId: item.url || item.stream || item.link || item.id,
      group: item.group || item.category || item.genre || '',
      logo: item.logo || item.icon || item.logo_url || '',
      language: item.language || '',
      country: item.country || '',
      bitrate: parseInt(item.bitrate) || 0,
      resolution: item.resolution || '',
      fps: item.fps || null,
      number: parseInt(item.number || item.channel_number || item.num) || 0
    }));
  }

  async _importCSV(source) {
    // CSV source
    let content;
    if (source.baseUrl.startsWith('http')) {
      const response = await fetch(source.baseUrl, {
        headers: {
          'User-Agent': source.userAgent || 'Mozilla/5.0',
          ...source.headers
        }
      });
      content = await response.text();
    } else {
      content = fs.readFileSync(source.baseUrl, 'utf8');
    }
    
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV file is empty or has no data rows');
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const channels = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      
      channels.push({
        name: row.name || row.title || row.channel || `Channel ${i}`,
        streamId: row.url || row.stream || row.link || row.id,
        group: row.group || row.category || row.genre || '',
        logo: row.logo || row.icon || '',
        language: row.language || '',
        country: row.country || '',
        bitrate: parseInt(row.bitrate) || 0,
        resolution: row.resolution || '',
        fps: row.fps || null,
        number: parseInt(row.number || row.channel_number || row.num) || 0
      });
    }
    
    return channels;
  }

  async _importZIP(source) {
    // ZIP archive - extract and parse M3U inside
    const AdmZip = require('adm-zip');
    let zip;
    
    if (source.baseUrl.startsWith('http')) {
      const response = await fetch(source.baseUrl);
      const buffer = await response.arrayBuffer();
      zip = new AdmZip(Buffer.from(buffer));
    } else {
      zip = new AdmZip(source.baseUrl);
    }
    
    const zipEntries = zip.getEntries();
    let m3uContent = null;
    
    for (const entry of zipEntries) {
      if (entry.name.endsWith('.m3u') || entry.name.endsWith('.m3u8')) {
        m3uContent = entry.getData().toString('utf8');
        break;
      }
    }
    
    if (!m3uContent) {
      throw new Error('No M3U file found in ZIP archive');
    }
    
    const parsed = m3uParser.parseM3U(m3uContent);
    return parsed.map(item => ({
      name: item.name,
      streamId: item.url,
      url: item.url,
      group: item.group,
      logo: item.logo,
      language: item.language || '',
      country: item.country || '',
      bitrate: item.bitrate || 0,
      resolution: item.resolution || '',
      fps: item.fps || null,
      number: item.tvgId ? parseInt(item.tvgId) : 0
    }));
  }

  async _importLocal(source) {
    // Local media files
    const mediaPath = source.baseUrl;
    if (!fs.existsSync(mediaPath)) {
      throw new Error(`Local path not found: ${mediaPath}`);
    }
    
    const stat = fs.statSync(mediaPath);
    const channels = [];
    
    if (stat.isDirectory()) {
      // Scan directory for media files
      const supportedExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m3u8', '.mpd'];
      const files = fs.readdirSync(mediaPath);
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          const fullPath = path.join(mediaPath, file);
          channels.push({
            name: path.basename(file, ext),
            streamId: fullPath,
            group: path.basename(mediaPath),
            logo: '',
            language: '',
            country: '',
            bitrate: 0,
            resolution: '',
            fps: null,
            number: channels.length + 1
          });
        }
      }
    } else if (stat.isFile()) {
      // Single media file
      channels.push({
        name: path.basename(mediaPath, path.extname(mediaPath)),
        streamId: mediaPath,
        group: 'Local Media',
        logo: '',
        language: '',
        country: '',
        bitrate: 0,
        resolution: '',
        fps: null,
        number: 1
      });
    }
    
    return channels;
  }

  /**
   * Import all enabled sources.
   */
  async importAllEnabled() {
    const sources = runtime.getSources({ enabled: true });
    const results = [];
    
    for (const src of sources) {
      const result = await this.importChannels(src);
      results.push({ sourceId: src.id, name: src.name, ...result });
    }
    
    return results;
  }

  /**
   * Resync a source (re-import channels).
   */
  async resync(sourceId) {
    const src = runtime.getSource(sourceId);
    if (!src) return null;
    return this.importChannels(src);
  }
}

module.exports = new SourceRepository();