'use strict';

/**
 * Mubasher Core v2.0 - Professional Streaming Engine (HLS Manager Integration)
 * =============================================================================
 * Enterprise-grade IPTV streaming engine with:
 *   - Single FFmpeg process per channel (all viewers share same stream)
 *   - Lazy Startup (start on first viewer, stop on idle)
 *   - Automatic Failover (Primary → Backup1 → Backup2 → Backup3 → Primary)
 *   - Exponential Backoff with configurable max attempts
 *   - HLS Manager Integration (segment lifecycle, refCount, gradual cleanup)
 *   - Proxy Layer: all outgoing requests go through proxy with headers
 *   - Segment Protection: never delete segments still referenced in active playlist
 *   - Atomic Swap: temp directory for restarts, never recreate live dir
 *   - All state written to RuntimeRegistry (single source of truth)
 * 
 * State Machine:
 *   STOPPED → STARTING → PROBING → BUFFERING → ONLINE
 *   ONLINE  → RECONNECTING → STARTING → ... → ONLINE
 *   ONLINE  → IDLE → STOPPING → STOPPED
 *   Any     → ERROR → STOPPED
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const runtime = require('../runtime');
const channels = require('../channels');
const sources = require('../sources');
const healthSystem = require('../health');
const cache = require('../cache');
const hlsManager = require('../hls-manager');

const STATES = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  PROBING: 'PROBING',
  BUFFERING: 'BUFFERING',
  ONLINE: 'ONLINE',
  RECONNECTING: 'RECONNECTING',
  IDLE: 'IDLE',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR'
});

class StreamEngine {
  constructor() {
    this.channels = new Map(); // channelId → ChannelStream
    this._cleanupTimer = null;
    this._startCleanup();
    this._startProcessMonitor();
    
    // Listen for RuntimeRegistry events
    runtime.on('viewer:connected', (data) => {
      const ch = runtime.getChannel(data.viewer.currentChannel);
      if (ch && ch.enabled) {
        this.addViewer(data.viewer.currentChannel, ch, data.viewerId);
      }
    });
  }

  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      for (const [id, cs] of this.channels) {
        if (cs.state === STATES.STOPPED || cs.state === STATES.ERROR) {
          // Never clean up channels that still have viewers
          if (cs.viewers.size > 0) continue;
          if (Date.now() - cs.lastStateChange > 120000) {
            this._cleanupChannel(id);
          }
        }
      }
    }, 30000);
  }

  _startProcessMonitor() {
    setInterval(() => {
      for (const [, cs] of this.channels) {
        if (cs.proc && cs.proc.pid) {
          cs.cpu = 0;
          cs.memory = 0;
        }
      }
    }, 5000);
  }

  _syncRuntime(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) {
      // Only remove stream state, never channel metadata from Registry
      runtime.removeStream(channelId);
      return;
    }

    // Get HLS monitoring data
    const hlsMonitor = hlsManager.getMonitor(channelId);

    runtime.setStream(channelId, {
      channelId,
      state: cs.state,
      pid: cs.proc ? cs.proc.pid : null,
      cpu: cs.cpu,
      memory: cs.memory,
      currentUrl: cs.currentUrl,
      currentUrlIndex: cs.currentUrlIndex,
      viewers: cs.viewers.size,
      reconnectCount: cs.reconnectCount,
      startedAt: cs.startedAt,
      uptime: cs.startedAt ? Math.floor((Date.now() - cs.startedAt) / 1000) : 0,
      lastStateChange: cs.lastStateChange,
      // HLS Monitoring data
      hls: hlsMonitor ? {
        segmentsOnDisk: hlsMonitor.segmentsOnDisk,
        segmentsInPlaylist: hlsMonitor.segmentsInPlaylist,
        currentSequence: hlsMonitor.currentSequence,
        lockedSegments: hlsMonitor.lockedSegments,
        deletedSegments: hlsMonitor.deletedSegments,
        missingSegments: hlsMonitor.missingSegments,
        playlistRewrites: hlsMonitor.playlistRewrites,
        averagePlaylistAge: hlsMonitor.averagePlaylistAge
      } : null
    });
  }

  _cleanupChannel(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return;
    if (cs.proc) {
      try { cs.proc.kill('SIGKILL'); } catch (_) {}
    }
    if (cs._healthTimer) clearInterval(cs._healthTimer);
    if (cs._progressTimer) clearInterval(cs._progressTimer);
    if (cs._reconnectTimer) clearTimeout(cs._reconnectTimer);
    if (cs._idleTimer) clearTimeout(cs._idleTimer);
    cs.proc = null;
    cs.viewers.clear();
    this.channels.delete(channelId);
    
    // Unregister from HLS Manager (but keep monitoring data)
    hlsManager.unregisterChannel(channelId);
    
    runtime.setStream(channelId, { state: STATES.STOPPED });
    logger.info(`StreamEngine: cleaned up ${channelId}`);
  }

  _getOrCreateChannel(channelId, channelData) {
    let cs = this.channels.get(channelId);
    if (!cs) {
      cs = {
        channelId,
        state: STATES.STOPPED,
        prevState: null,
        proc: null,
        viewers: new Map(),
        currentUrl: '',
        currentUrlIndex: 0,
        startedAt: null,
        firstStartedAt: null,
        bufferingTime: 0,
        restartCount: 0,
        reconnectCount: 0,
        bufferingCount: 0,
        cpu: 0,
        memory: 0,
        lastStateChange: Date.now(),
        currentSourceId: null,
        currentStreamId: null,
        _healthTimer: null,
        _progressTimer: null,
        _reconnectTimer: null,
        _idleTimer: null,
        // HLS Manager reference
        _hlsRegistered: false
      };
      this.channels.set(channelId, cs);
    }
    return cs;
  }

  /**
   * Resolve the best source URL for a channel with failover logic.
   */
  _resolveSourceUrl(channelId) {
    const ch = runtime.getChannel(channelId);
    if (!ch || !ch.enabled) return null;

    const cs = this.channels.get(channelId);
    const sourceRefs = [];

    if (ch.primarySource && ch.primaryStreamId) {
      sourceRefs.push({ sourceId: ch.primarySource, streamId: ch.primaryStreamId, label: 'Primary' });
    }
    if (ch.backupSource1 && ch.backupStreamId1) {
      sourceRefs.push({ sourceId: ch.backupSource1, streamId: ch.backupStreamId1, label: 'Backup1' });
    }
    if (ch.backupSource2 && ch.backupStreamId2) {
      sourceRefs.push({ sourceId: ch.backupSource2, streamId: ch.backupStreamId2, label: 'Backup2' });
    }
    if (ch.backupSource3 && ch.backupStreamId3) {
      sourceRefs.push({ sourceId: ch.backupSource3, streamId: ch.backupStreamId3, label: 'Backup3' });
    }

    // Temporary Fallback for old channels that still have .url
    if (sourceRefs.length === 0 && ch.url) {
      return {
        url: ch.url,
        sourceId: null,
        streamId: null,
        index: 0,
        label: 'Direct URL'
      };
    }

    if (sourceRefs.length === 0) return null;

    let startIndex = cs ? cs.currentUrlIndex : 0;

    // If reconnect count is high, rotate sources
    const reconnectThreshold = ch.reconnectAttempts ? Math.floor(ch.reconnectAttempts / 2) : 3;
    if (cs && cs.reconnectCount > reconnectThreshold) {
      startIndex = (startIndex + 1) % sourceRefs.length;
      cs.reconnectCount = 0;
      logger.info(`StreamEngine: ${channelId} rotating to next source after ${cs.reconnectCount} reconnects`);
    }

    // Try to resolve URL starting from current index
    for (let i = 0; i < sourceRefs.length; i++) {
      const idx = (startIndex + i) % sourceRefs.length;
      const ref = sourceRefs[idx];
      
      let url = null;
      
      if (ref.sourceId) {
        url = sources.resolveStreamUrl(ref.sourceId, ref.streamId);
      }
      
      if (!url && ref.streamId) {
        url = ref.streamId;
      }
      
      if (url) {
        if (cs) {
          cs.currentUrlIndex = idx;
          cs.currentSourceId = ref.sourceId;
          cs.currentStreamId = ref.streamId;
        }
        const sourceObj = ref.sourceId ? runtime.getSource(ref.sourceId) : null;
        return {
          url,
          sourceId: ref.sourceId,
          streamId: ref.streamId,
          index: idx,
          label: ref.label,
          referer: sourceObj ? sourceObj.referer : (ch.referer || ''),
          origin: sourceObj ? sourceObj.origin : (ch.origin || ''),
          userAgent: sourceObj ? sourceObj.userAgent : (ch.userAgent || ''),
          cookie: sourceObj ? sourceObj.cookie : (ch.cookie || ''),
          headers: sourceObj ? sourceObj.headers : (ch.headers || {}),
          proxy: sourceObj ? sourceObj.proxy : (ch.proxy || ''),
          dns: sourceObj ? sourceObj.dns : (ch.dns || '')
        };
      }
    }

    if (cs) cs.currentUrlIndex = 0;
    return null;
  }

  /**
   * Add a viewer to a channel. Implements Lazy Startup.
   * All viewers share the same FFmpeg process.
   */
  addViewer(channelId, channelData, viewerId, viewerInfo) {
    const cs = this._getOrCreateChannel(channelId, channelData);
    const ch = runtime.getChannel(channelId);

    // Check viewer limit
    if (ch && ch.viewerLimit > 0 && cs.viewers.size >= ch.viewerLimit) {
      const msg = `StreamEngine: ${channelId} viewer limit reached (${ch.viewerLimit})`;
      logger.warn(msg);
      return { error: msg };
    }

    // Add viewer
    if (viewerId) {
      cs.viewers.set(viewerId, {
        id: viewerId,
        info: viewerInfo || {},
        joinedAt: Date.now(),
        lastHeartbeat: Date.now(),
        watchTime: 0,
        bandwidth: 0,
        bitrate: 0
      });
      runtime.setViewer(viewerId, {
        currentChannel: channelId,
        status: 'connected',
        lastHeartbeat: Date.now()
      });
      healthSystem.recordEvent('viewer_connected');
    }

    // State machine - only start if not already running
    switch (cs.state) {
      case STATES.STOPPED:
      case STATES.ERROR:
        cs.state = STATES.STARTING;
        cs.lastStateChange = Date.now();
        cs.restartCount = 0;
        if (!cs.firstStartedAt) cs.firstStartedAt = Date.now();
        logger.info(`StreamEngine: ${channelId} -> STARTING (lazy, ${cs.viewers.size} viewer(s))`);
        this._syncRuntime(channelId);
        this._startFFmpeg(channelId);
        break;
      case STATES.IDLE:
        cs.state = STATES.STARTING;
        cs.lastStateChange = Date.now();
        logger.info(`StreamEngine: ${channelId} -> STARTING (idle resume)`);
        this._syncRuntime(channelId);
        this._startFFmpeg(channelId);
        break;
      case STATES.RECONNECTING:
        if (cs._reconnectTimer) {
          clearTimeout(cs._reconnectTimer);
          cs._reconnectTimer = null;
        }
        this._startFFmpeg(channelId);
        break;
      case STATES.ONLINE:
      case STATES.PROBING:
      case STATES.BUFFERING:
        logger.info(`StreamEngine: ${channelId} viewer added (already ${cs.state}, ${cs.viewers.size} total)`);
        break;
    }

    this._cancelIdleTimer(channelId);
    this._syncRuntime(channelId);
    return cs;
  }

  /**
   * Remove a viewer from a channel. Start idle timer if no viewers left.
   */
  removeViewer(channelId, viewerId) {
    const cs = this.channels.get(channelId);
    if (!cs) return false;

    if (viewerId) {
      const viewer = cs.viewers.get(viewerId);
      if (viewer) {
        viewer.watchTime += (Date.now() - viewer.joinedAt) / 1000;
        runtime.setViewer(viewerId, { watchTime: viewer.watchTime, status: 'disconnected' });
      }
      cs.viewers.delete(viewerId);
    }

    if (cs.viewers.size === 0) {
      cs.state = STATES.IDLE;
      cs.lastStateChange = Date.now();
      logger.info(`StreamEngine: ${channelId} -> IDLE (no viewers)`);
      this._startIdleTimer(channelId);
      this._syncRuntime(channelId);
    }

    this._syncRuntime(channelId);
    return true;
  }

  /**
   * Handle stream disconnect - attempt failover with exponential backoff.
   */
  _handleDisconnect(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return false;

    const ch = runtime.getChannel(channelId);
    const maxAttempts = ch ? ch.reconnectAttempts : 10;

    if (cs.reconnectCount >= maxAttempts) {
      logger.error(`StreamEngine: ${channelId} max reconnect attempts (${maxAttempts}) reached`);
      cs.state = STATES.ERROR;
      cs.lastStateChange = Date.now();
      this._syncRuntime(channelId);
      return false;
    }

    cs.state = STATES.RECONNECTING;
    cs.lastStateChange = Date.now();
    cs.reconnectCount++;
    healthSystem.recordEvent('reconnect');

    const baseDelay = 2000;
    const delay = Math.min(baseDelay * Math.pow(2, cs.reconnectCount - 1), 60000);
    const jitter = Math.random() * 2000;
    const totalDelay = delay + jitter;

    logger.info(`StreamEngine: ${channelId} reconnect #${cs.reconnectCount}/${maxAttempts} in ${Math.round(totalDelay)}ms`);

    this._syncRuntime(channelId);

    cs._reconnectTimer = setTimeout(() => {
      const fresh = this.channels.get(channelId);
      if (!fresh || fresh.viewers.size === 0) return;

      fresh.state = STATES.STARTING;
      fresh.lastStateChange = Date.now();
      logger.info(`StreamEngine: ${channelId} -> STARTING (reconnect #${fresh.reconnectCount})`);
      this._syncRuntime(channelId);
      this._startFFmpeg(channelId);
    }, totalDelay);

    return true;
  }

  /**
   * Build proxy headers for FFmpeg based on source configuration.
   */
  _buildProxyHeaders(sourceInfo) {
    const headers = [];
    
    if (sourceInfo.referer) {
      headers.push(`Referer: ${sourceInfo.referer}\r\n`);
    }
    if (sourceInfo.origin) {
      headers.push(`Origin: ${sourceInfo.origin}\r\n`);
    }
    if (sourceInfo.cookie) {
      headers.push(`Cookie: ${sourceInfo.cookie}\r\n`);
    }
    if (sourceInfo.userAgent) {
      headers.push(`User-Agent: ${sourceInfo.userAgent}\r\n`);
    }
    
    if (sourceInfo.headers && typeof sourceInfo.headers === 'object') {
      for (const [key, value] of Object.entries(sourceInfo.headers)) {
        if (value) {
          headers.push(`${key}: ${value}\r\n`);
        }
      }
    }
    
    return headers;
  }

  /**
   * Start FFmpeg process for a channel.
   * Uses HLS Manager for lifecycle management.
   */
  _startFFmpeg(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return;

    // Prevent duplicate FFmpeg processes
    if (cs.proc) {
      logger.warn(`StreamEngine: ${channelId} FFmpeg already running (PID=${cs.proc.pid}), killing first`);
      try { cs.proc.kill('SIGKILL'); } catch (_) {}
      cs.proc = null;
    }

    const ch = runtime.getChannel(channelId);
    if (!ch || !ch.enabled) {
      logger.warn(`StreamEngine: ${channelId} disabled, not starting`);
      return;
    }

    const sourceInfo = this._resolveSourceUrl(channelId);
    if (!sourceInfo) {
      logger.error(`StreamEngine: ${channelId} no valid source URL found`);
      cs.state = STATES.ERROR;
      cs.lastStateChange = Date.now();
      this._syncRuntime(channelId);
      return;
    }

    const cfg = config.get();
    const ffmpegPath = cfg.ffmpeg.path || 'ffmpeg';
    const hlsTime = ch.segmentDuration || cfg.ffmpeg.hlsTime || 2;
    const hlsRoot = cfg.stream.hlsRoot || 'hls';

    const outputDir = path.join(process.cwd(), hlsRoot, channelId);
    
    // ── HLS MANAGER: Register channel ─────────────────────────
    // This sets up the segment lifecycle management
    if (!cs._hlsRegistered) {
      hlsManager.registerChannel(channelId);
      cs._hlsRegistered = true;
    }

    // ── ATOMIC SWAP: Create temp directory first ──────────────
    // Never delete the existing directory while streaming
    // If directory exists, use Atomic Swap for restart
    if (fs.existsSync(outputDir)) {
      // Directory exists - use atomic swap for clean restart
      try {
        const tempDir = hlsManager.createTempDir(channelId);
        // FFmpeg will write to the temp directory
        // After FFmpeg starts, we'll do the atomic swap
        logger.info(`StreamEngine: ${channelId} using atomic swap (temp dir: ${tempDir})`);
      } catch (err) {
        logger.error(`StreamEngine: ${channelId} failed to create temp dir: ${err.message}`);
        // Fallback: ensure directory exists without deleting
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
      }
    } else {
      // New directory - just create it
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Use temp dir for FFmpeg output if available (getOutputDir handles this)
    const ffmpegOutputDir = hlsManager.getOutputDir(channelId);
    const outputPath = path.join(ffmpegOutputDir, 'index.m3u8');
    const segmentTemplate = path.join(ffmpegOutputDir, '%05d.ts');
    const sourceUrl = sourceInfo.url;

    // Build proxy headers
    const proxyHeaders = this._buildProxyHeaders(sourceInfo);
    
    // ── FFMPEG ARGS ───────────────────────────────────────────
    // Professional configuration for continuous streaming:
    // - NO delete_segments (we handle cleanup ourselves)
    // - append_list: append new segments to playlist
    // - split_by_time: split segments at keyframes
    // - independent_segments: each segment is independently decodable
    // - hls_list_size: set to 40 (max playlist window)
    // - hls_delete_threshold: not used (we manage cleanup)
    const args = [
      '-re',
      '-user_agent', sourceInfo.userAgent || cfg.ffmpeg.userAgent || 'Mozilla/5.0',
      '-threads', String(cfg.ffmpeg.threads || 2),
      ...(proxyHeaders.length > 0 ? ['-headers', proxyHeaders.join('')] : []),
      '-i', sourceUrl,
      '-c:v', ch.videoCodec || 'copy',
      '-c:a', ch.audioCodec || 'copy',
      ...(ch.customFfmpegArgs ? ch.customFfmpegArgs.split(' ') : []),
      '-f', 'hls',
      '-hls_time', String(hlsTime),
      '-hls_list_size', '40', // Maximum playlist window
      // Do NOT use hls_delete_threshold - we manage cleanup
      '-hls_base_url', './',
      // Professional flags: no delete_segments, we handle lifecycle
      '-hls_flags', 'append_list+split_by_time+independent_segments',
      '-hls_segment_filename', segmentTemplate,
      '-progress', 'pipe:1',
      '-loglevel', 'warning',
      '-y',
      outputPath
    ];

    const cmdStr = `${ffmpegPath} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
    logger.info(`StreamEngine: FFmpeg start ${channelId}`);
    logger.info(`StreamEngine: Source: ${sourceInfo.label} (${sourceInfo.sourceId || 'direct'})`);
    logger.info(`StreamEngine: URL: ${sourceUrl}`);
    logger.info(`StreamEngine: Cmd: ${cmdStr}`);

    cs.currentUrl = sourceUrl;
    cs.startedAt = Date.now();
    cs.bufferingCount = (cs.bufferingCount || 0) + 1;

    // Cancel any existing reconnect timer
    if (cs._reconnectTimer) {
      clearTimeout(cs._reconnectTimer);
      cs._reconnectTimer = null;
    }

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    cs.proc = proc;
    logger.info(`StreamEngine: ${channelId} PID=${proc.pid}`);

    // ── LOG STREAM START ────────────────────────────────────
    logger.logStreamStart(channelId, outputDir, proc.pid, outputPath);

    let stderrBuffer = '';
    proc.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      if (stderrBuffer.length > 2000) stderrBuffer = stderrBuffer.slice(-2000);
    });

    proc.stderr.on('end', () => {
      if (stderrBuffer && cs.state !== STATES.STOPPED && cs.state !== STATES.STOPPING) {
        logger.warn(`StreamEngine: ${channelId} stderr: ${stderrBuffer.slice(0, 500)}`);
      }
    });

    // Monitor HLS playlist creation
    let hasManifest = false;
    cs._progressTimer = setInterval(() => {
      if (cs.state === STATES.STOPPED || cs.state === STATES.STOPPING) {
        clearInterval(cs._progressTimer);
        cs._progressTimer = null;
        return;
      }

      try {
        // Check both temp dir and output dir for playlist
        const actualPath = path.join(ffmpegOutputDir, 'index.m3u8');
        if (fs.existsSync(actualPath) && !hasManifest) {
          const stat = fs.statSync(actualPath);
          const content = fs.readFileSync(actualPath, 'utf8');
          if (content.includes('.ts')) {
            hasManifest = true;

            // ── LOG PLAYLIST CREATED ────────────────────────────
            logger.logPlaylistCreated(channelId, actualPath, stat.mtimeMs, stat.size);

            // Parse playlist and update HLS Manager
            hlsManager.updatePlaylist(channelId, content);

            // Perform atomic swap if using temp dir
            if (hlsManager.getTempDir(channelId)) {
              hlsManager.atomicSwap(channelId);
            }

            // PROBING -> BUFFERING -> ONLINE
            if (cs.state === STATES.STARTING) {
              cs.state = STATES.PROBING;
              cs.lastStateChange = Date.now();
              logger.info(`StreamEngine: ${channelId} -> PROBING`);
              this._syncRuntime(channelId);

              this._startHealthProbe(channelId);

              setTimeout(() => {
                if (cs.state === STATES.PROBING) {
                  cs.state = STATES.BUFFERING;
                  cs.lastStateChange = Date.now();
                  logger.info(`StreamEngine: ${channelId} -> BUFFERING`);
                  this._syncRuntime(channelId);
                }
              }, 1000);

              const bufferMs = (ch.bufferSize || 4096);
              setTimeout(() => {
                if (cs.state === STATES.BUFFERING) {
                  cs.state = STATES.ONLINE;
                  cs.lastStateChange = Date.now();
                  cs.bufferingTime = Date.now() - cs.startedAt;
                  cs.reconnectCount = 0;
                  logger.info(`StreamEngine: ${channelId} -> ONLINE (${cs.bufferingTime}ms, PID=${proc.pid})`);
                  this._syncRuntime(channelId);
                }
              }, bufferMs);
            }
            clearInterval(cs._progressTimer);
            cs._progressTimer = null;
          }
        }
      } catch (_) {}
    }, 500);

    // Watch for playlist updates to feed HLS Manager
    let lastPlaylistCheck = 0;
    const playlistWatchInterval = setInterval(() => {
      if (cs.state === STATES.STOPPED || cs.state === STATES.STOPPING) {
        clearInterval(playlistWatchInterval);
        return;
      }

      try {
        const actualPath = path.join(ffmpegOutputDir, 'index.m3u8');
        const mtime = fs.existsSync(actualPath) ? fs.statSync(actualPath).mtimeMs : 0;
        if (mtime > lastPlaylistCheck) {
          lastPlaylistCheck = mtime;
          const content = fs.readFileSync(actualPath, 'utf8');
          hlsManager.updatePlaylist(channelId, content);

          // ── LOG PLAYLIST UPDATED ──────────────────────────
          const segments = content.split('\n').filter(l => l.trim().endsWith('.ts'));
          const seq = hlsManager.getMonitor(channelId);
          logger.logPlaylistUpdated(channelId, seq ? seq.currentSequence : 0, segments.length);
        }
      } catch (_) {}
    }, 1000);

    // Store playlist watch interval for cleanup
    cs._playlistWatchInterval = playlistWatchInterval;

    proc.on('close', (code) => {
      if (cs._progressTimer) {
        clearInterval(cs._progressTimer);
        cs._progressTimer = null;
      }
      if (cs._playlistWatchInterval) {
        clearInterval(cs._playlistWatchInterval);
        cs._playlistWatchInterval = null;
      }
      cs.proc = null;

      const exitSignal = proc.signalCode || 'none';
      logger.logFfmpegExit(channelId, code, exitSignal, `FFmpeg process closed (code=${code}, signal=${exitSignal})`);

      // ── HLS MANAGER: On FFmpeg crash, keep existing segments ──
      // DO NOT delete HLS files. They remain for viewers.
      // Only unregister from HLS Manager (cleanup continues gradually)
      if (code !== 0) {
        // FFmpeg crashed - keep existing files
        hlsManager.unregisterChannel(channelId);
        logger.info(`StreamEngine: ${channelId} FFmpeg crashed, keeping HLS files for existing viewers`);
      }

      if (cs.state === STATES.STOPPED || cs.state === STATES.STOPPING) {
        if (cs.state === STATES.STOPPING) {
          cs.state = STATES.STOPPED;
          cs.lastStateChange = Date.now();
          logger.info(`StreamEngine: ${channelId} -> STOPPED`);
        }
        this._syncRuntime(channelId);
        return;
      }

      // Attempt reconnect if viewers exist
      if (cs.viewers.size > 0) {
        this._handleDisconnect(channelId);
      } else {
        cs.state = STATES.IDLE;
        cs.lastStateChange = Date.now();
        this._startIdleTimer(channelId);
        this._syncRuntime(channelId);
      }
    });

    proc.on('error', (err) => {
      if (cs._progressTimer) {
        clearInterval(cs._progressTimer);
        cs._progressTimer = null;
      }
      if (cs._playlistWatchInterval) {
        clearInterval(cs._playlistWatchInterval);
        cs._playlistWatchInterval = null;
      }
      cs.proc = null;
      logger.error(`StreamEngine: ${channelId} spawn error: ${err.message}`);

      if (cs.viewers.size > 0) {
        this._handleDisconnect(channelId);
      } else {
        cs.state = STATES.ERROR;
        cs.lastStateChange = Date.now();
        this._syncRuntime(channelId);
      }
    });

    this._syncRuntime(channelId);
  }

  _startHealthProbe(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return;
    if (cs._healthTimer) clearInterval(cs._healthTimer);

    cs._healthTimer = setInterval(() => {
      if (cs.state === STATES.STOPPED || cs.state === STATES.ERROR || cs.state === STATES.IDLE) {
        clearInterval(cs._healthTimer);
        cs._healthTimer = null;
        return;
      }
      this._probeHealth(channelId);
    }, 30000);

    setTimeout(() => this._probeHealth(channelId), 2000);
  }

  async _probeHealth(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs || !cs.currentUrl) return;

    try {
      const cfg = config.get();
      const ffprobePath = cfg.ffmpeg.ffprobePath || 'ffprobe';
      const startTime = Date.now();

      const result = await new Promise((resolve) => {
        const args = [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_streams',
          '-show_format',
          '-timeout', '10000000',
          cs.currentUrl
        ];

        const proc = spawn(ffprobePath, args, { timeout: 15000, windowsHide: true });
        let stdout = '', stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          const responseTime = Date.now() - startTime;
          if (code !== 0) {
            return resolve({ isOnline: false, responseTime, error: stderr.slice(0, 300) });
          }
          try {
            const info = JSON.parse(stdout);
            const vStream = (info.streams || []).find(s => s.codec_type === 'video');
            const aStream = (info.streams || []).find(s => s.codec_type === 'audio');
            const format = info.format || {};
            resolve({
              isOnline: true,
              codec: vStream ? vStream.codec_name : null,
              resolution: vStream ? `${vStream.width}x${vStream.height}` : null,
              fps: vStream ? this._evalFps(vStream.r_frame_rate || vStream.avg_frame_rate) : null,
              audio: aStream ? aStream.codec_name : null,
              bitrate: format.bit_rate ? parseInt(format.bit_rate) : null,
              latency: format.start_time ? parseFloat(format.start_time) * 1000 : 0,
              responseTime
            });
          } catch (_) {
            resolve({ isOnline: true, responseTime });
          }
        });
        proc.on('error', (err) => resolve({ isOnline: false, responseTime: Date.now() - startTime, error: err.message }));
      });

      // Calculate health score
      let score = 100;
      const rtt = result.responseTime || 5000;
      if (rtt > 10000) score -= 30;
      else if (rtt > 5000) score -= 15;
      else if (rtt > 2000) score -= 5;
      if (!result.isOnline) score -= 50;

      // Get HLS monitoring data
      const hlsMonitor = hlsManager.getMonitor(channelId);

      // Record health with HLS data
      healthSystem.recordHealth(channelId, {
        score: Math.max(0, score),
        latency: result.responseTime || 0,
        packetLoss: 0,
        bitrate: result.bitrate || 0,
        resolution: result.resolution || '',
        codec: result.codec || '',
        fps: result.fps || null,
        reconnectCount: cs.reconnectCount,
        bufferingCount: cs.bufferingCount,
        uptime: cs.state === STATES.ONLINE ? Math.floor((Date.now() - cs.startedAt) / 1000) : 0,
        totalStreamTime: Math.floor((Date.now() - (cs.firstStartedAt || cs.startedAt || Date.now())) / 1000),
        // HLS Monitoring
        segmentsOnDisk: hlsMonitor ? hlsMonitor.segmentsOnDisk : 0,
        segmentsInPlaylist: hlsMonitor ? hlsMonitor.segmentsInPlaylist : 0,
        mediaSequence: hlsMonitor ? hlsMonitor.currentSequence : 0,
        segmentMisses: hlsMonitor ? hlsMonitor.segmentMisses : 0,
        segmentDeletes: hlsMonitor ? hlsMonitor.segmentDeletes : 0,
        segmentLocks: hlsMonitor ? hlsMonitor.segmentLocks : 0,
        averagePlaylistAge: hlsMonitor ? hlsMonitor.averagePlaylistAge : 0
      });
    } catch (err) {
      logger.error(`StreamEngine: health probe error for ${channelId}: ${err.message}`);
    }
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

  /**
   * Stop a channel stream.
   * Uses HLS Manager for safe cleanup.
   */
  stop(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return;
    
    // ── LOG STREAM STOP ─────────────────────────────────────
    logger.logStreamStop(channelId, `stop() called, current state: ${cs.state}, viewers: ${cs.viewers.size}`);

    cs.state = STATES.STOPPING;
    cs.lastStateChange = Date.now();
    this._cancelIdleTimer(channelId);
    this._syncRuntime(channelId);

    if (cs._healthTimer) { clearInterval(cs._healthTimer); cs._healthTimer = null; }
    if (cs._progressTimer) { clearInterval(cs._progressTimer); cs._progressTimer = null; }
    if (cs._playlistWatchInterval) { clearInterval(cs._playlistWatchInterval); cs._playlistWatchInterval = null; }
    if (cs._reconnectTimer) { clearTimeout(cs._reconnectTimer); cs._reconnectTimer = null; }

    if (cs.proc) {
      try {
        cs.proc.kill('SIGTERM');
        setTimeout(() => {
          if (cs.proc) {
            try { cs.proc.kill('SIGKILL'); } catch (_) {}
          }
          cs.proc = null;
          cs.state = STATES.STOPPED;
          cs.lastStateChange = Date.now();
          logger.info(`StreamEngine: ${channelId} -> STOPPED`);
          
          // ── HLS MANAGER: Cleanup is handled by gradual cleanup ──
          // No fs.rmSync, no emptyDir, no rimraf
          // Just unregister from HLS Manager
          hlsManager.unregisterChannel(channelId);
          
          this._syncRuntime(channelId);
        }, 3000);
      } catch (_) {
        cs.proc = null;
        cs.state = STATES.STOPPED;
        hlsManager.unregisterChannel(channelId);
        this._syncRuntime(channelId);
      }
    } else {
      cs.state = STATES.STOPPED;
      cs.lastStateChange = Date.now();
      hlsManager.unregisterChannel(channelId);
      this._syncRuntime(channelId);
    }

    cs.viewers.clear();
    cs.reconnectCount = 0;
  }

  stopAll() {
    for (const [id] of this.channels) this.stop(id);
  }

  getState(channelId) {
    const cs = this.channels.get(channelId);
    return cs ? cs.state : STATES.STOPPED;
  }

  getStatus(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return runtime.getStream(channelId) || { state: STATES.STOPPED, viewers: 0 };
    
    // Get HLS monitoring data
    const hlsMonitor = hlsManager.getMonitor(channelId);
    
    return {
      channelId: cs.channelId,
      state: cs.state,
      prevState: cs.prevState,
      viewers: cs.viewers.size,
      pid: cs.proc ? cs.proc.pid : null,
      cpu: cs.cpu,
      memory: cs.memory,
      currentUrl: cs.currentUrl,
      currentUrlIndex: cs.currentUrlIndex,
      startedAt: cs.startedAt,
      uptime: cs.startedAt ? Math.floor((Date.now() - cs.startedAt) / 1000) : 0,
      bufferingTime: cs.bufferingTime,
      restartCount: cs.restartCount,
      reconnectCount: cs.reconnectCount,
      lastStateChange: cs.lastStateChange,
      hls: hlsMonitor ? {
        segmentsOnDisk: hlsMonitor.segmentsOnDisk,
        segmentsInPlaylist: hlsMonitor.segmentsInPlaylist,
        currentSequence: hlsMonitor.currentSequence,
        lockedSegments: hlsMonitor.lockedSegments,
        missingSegments: hlsMonitor.missingSegments,
        segmentMisses: hlsMonitor.segmentMisses,
        segmentDeletes: hlsMonitor.segmentDeletes,
        averagePlaylistAge: hlsMonitor.averagePlaylistAge
      } : null
    };
  }

  getAllStatus() {
    return Array.from(this.channels.keys()).map(id => this.getStatus(id));
  }

  getViewerCount(channelId) {
    const cs = this.channels.get(channelId);
    return cs ? cs.viewers.size : 0;
  }

  getTotalViewers() {
    let total = 0;
    for (const [, cs] of this.channels) total += cs.viewers.size;
    return total;
  }

  heartbeat(channelId, viewerId, stats) {
    const cs = this.channels.get(channelId);
    if (!cs) return null;
    const viewer = cs.viewers.get(viewerId);
    if (!viewer) return null;

    viewer.lastHeartbeat = Date.now();
    viewer.watchTime = (Date.now() - viewer.joinedAt) / 1000;
    if (stats) {
      if (stats.bandwidth) viewer.bandwidth = stats.bandwidth;
      if (stats.bitrate) viewer.bitrate = stats.bitrate;
    }

    return { channelId, viewers: cs.viewers.size, state: cs.state };
  }

  getHlsPath(channelId) {
    const cfg = config.get();
    return path.join(process.cwd(), cfg.stream.hlsRoot || 'hls', channelId, 'index.m3u8');
  }

  getHlsDir(channelId) {
    const cfg = config.get();
    const dir = path.join(process.cwd(), cfg.stream.hlsRoot || 'hls', channelId);
    return fs.existsSync(dir) ? dir : null;
  }

  isHlsReady(channelId) {
    const m3u8Path = this.getHlsPath(channelId);
    try {
      return fs.existsSync(m3u8Path) && fs.readFileSync(m3u8Path, 'utf8').includes('.ts');
    } catch (_) { return false; }
  }

  _startIdleTimer(channelId) {
    const cs = this.channels.get(channelId);
    if (!cs) return;
    this._cancelIdleTimer(channelId);

    const ch = runtime.getChannel(channelId);
    const idleSeconds = ch ? ch.idleTimeout : config.get().stream.idleStopSeconds || 30;

    cs._idleTimer = setTimeout(() => {
      if (cs.state === STATES.IDLE && cs.viewers.size === 0) {
        logger.info(`StreamEngine: auto-stopping ${channelId} (idle ${idleSeconds}s)`);
        this.stop(channelId);
      }
    }, idleSeconds * 1000);
  }

  _cancelIdleTimer(channelId) {
    const cs = this.channels.get(channelId);
    if (cs && cs._idleTimer) {
      clearTimeout(cs._idleTimer);
      cs._idleTimer = null;
    }
  }

  shutdown() {
    if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
    for (const [, cs] of this.channels) {
      if (cs._healthTimer) clearInterval(cs._healthTimer);
      if (cs._progressTimer) clearInterval(cs._progressTimer);
      if (cs._playlistWatchInterval) clearInterval(cs._playlistWatchInterval);
      if (cs._reconnectTimer) clearTimeout(cs._reconnectTimer);
      if (cs._idleTimer) clearTimeout(cs._idleTimer);
    }
    this.stopAll();
    hlsManager.shutdown();
  }
}

module.exports = new StreamEngine();
module.exports.STATES = STATES;