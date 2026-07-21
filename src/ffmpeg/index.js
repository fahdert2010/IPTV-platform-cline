'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');

/**
 * FFmpeg Manager — Real FFmpeg process management.
 * One process per channel. Uses -c copy (no re-encoding).
 */
class FFmpegManager {
  constructor() {
    this.processes = new Map(); // channelId -> { proc, viewers, timer, startedAt, restartCount }
  }

  /**
   * Get or create an FFmpeg process for a channel.
   */
  getOrCreate(channelId, channelUrl) {
    let entry = this.processes.get(channelId);
    if (!entry) {
      entry = {
        proc: null,
        viewers: 0,
        idleTimer: null,
        startedAt: null,
        restartCount: 0,
        currentUrl: channelUrl,
        channelId
      };
      this.processes.set(channelId, entry);
    }
    return entry;
  }

  /**
   * Start FFmpeg for a channel.
   */
  start(channelId, channelUrl) {
    const entry = this.getOrCreate(channelId, channelUrl);
    entry.currentUrl = channelUrl;

    if (entry.proc && this.isRunning(entry.proc)) {
      entry.viewers++;
      return;
    }

    const cfg = config.get();
    const ffmpegPath = cfg.ffmpeg.path || 'ffmpeg';
    const hlsTime = cfg.ffmpeg.hlsTime || 2;
    const hlsListSize = cfg.ffmpeg.hlsListSize || 6;
    const hlsDeleteThreshold = cfg.ffmpeg.hlsDeleteThreshold || 4;
    const hlsRoot = cfg.stream.hlsRoot || 'hls';

    const outputDir = path.join(process.cwd(), hlsRoot, channelId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'index.m3u8');

    const args = [
      '-i', channelUrl,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'hls',
      '-hls_time', String(hlsTime),
      '-hls_list_size', String(hlsListSize),
      '-hls_delete_threshold', String(hlsDeleteThreshold),
      '-hls_flags', 'delete_segments+append_list+split_by_time',
      '-hls_segment_filename', path.join(outputDir, '%05d.ts'),
      '-progress', 'pipe:1',
      '-loglevel', 'warning',
      '-y',
      outputPath
    ];

    // ────── LOG STEPS 4-5: Full command and paths ──────
    const cmdStr = ffmpegPath + ' ' + args.map(a => a.includes(' ') ? '"' + a + '"' : a).join(' ');
    logger.info('══════════ FFMPEG TRACE ══════════');
    logger.info(`STEP 3: Channel name: ${channelId}`);
    logger.info(`STEP 4: Full FFmpeg command: ${cmdStr}`);
    logger.info(`STEP 5: Output path: ${outputPath}`);
    logger.info(`STEP 5: Output dir: ${outputDir}`);
    logger.info(`STEP 5: Segment filename template: ${path.join(outputDir, '%05d.ts')}`);

    logger.info(`FFmpeg: starting channel ${channelId}`, { url: channelUrl });

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    entry.proc = proc;
    entry.startedAt = new Date();
    entry.viewers = Math.max(1, entry.viewers + 1);

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      logger.warn(`FFmpeg: ${channelId} stderr`, { msg: msg.slice(0, 200) });
    });

    proc.on('close', (code) => {
      entry.proc = null;
      entry.startedAt = null;
      logger.info(`FFmpeg: ${channelId} exited (code ${code})`);

      // ────── LOG STEP 6: Check if index.m3u8 was created ──────
      const fs = require('fs');
      if (fs.existsSync(outputPath)) {
        logger.info(`STEP 6: index.m3u8 EXISTS at: ${outputPath}`);
        try {
          const content = fs.readFileSync(outputPath, 'utf8');
          const lines = content.split('\n').slice(0, 10);
          const first10 = lines.join('\n');
          logger.info(`STEP 6: First 10 lines of index.m3u8:\n${first10}`);
          logger.info(`STEP 6: File size: ${fs.statSync(outputPath).size} bytes`);
        } catch (e) {
          logger.error(`STEP 6: Could not read index.m3u8: ${e.message}`);
        }
      } else {
        logger.info(`STEP 6: index.m3u8 DOES NOT EXIST at: ${outputPath}`);
        // Check if directory exists
        if (fs.existsSync(outputDir)) {
          logger.info(`STEP 6: Output directory EXISTS: ${outputDir}`);
          const files = fs.readdirSync(outputDir);
          logger.info(`STEP 6: Files in output dir: ${files.join(', ') || '(empty)'}`);
        } else {
          logger.info(`STEP 6: Output directory DOES NOT EXIST: ${outputDir}`);
        }
      }

      if (code !== 0 && entry.viewers > 0 && cfg.stream.autoRestartCrashed !== false) {
        this.scheduleRestart(channelId);
      }
    });

    proc.on('error', (err) => {
      entry.proc = null;
      logger.error(`FFmpeg: ${channelId} error`, { error: err.message });
      if (entry.viewers > 0) this.scheduleRestart(channelId);
    });
  }

  /**
   * Schedule restart with exponential backoff.
   */
  scheduleRestart(channelId) {
    const entry = this.processes.get(channelId);
    if (!entry) return;
    const cfg = config.get();
    const maxRestarts = cfg.stream.maxRestarts || 20;
    const backoffMs = cfg.stream.restartBackoffMs || 5000;

    if (entry.restartCount >= maxRestarts) {
      logger.error(`FFmpeg: ${channelId} max restarts reached`);
      return;
    }

    entry.restartCount++;
    const delay = Math.min(backoffMs * entry.restartCount, 60000);

    logger.info(`FFmpeg: ${channelId} restart in ${delay}ms (attempt ${entry.restartCount})`);
    setTimeout(() => {
      const e = this.processes.get(channelId);
      if (e && e.viewers > 0 && !e.proc) {
        this.start(channelId, e.currentUrl);
      }
    }, delay);
  }

  /**
   * Add a viewer to a channel.
   */
  addViewer(channelId, channelUrl) {
    const entry = this.getOrCreate(channelId, channelUrl);
    entry.viewers++;
    this.clearIdleTimer(channelId);

    if (!entry.proc || !this.isRunning(entry.proc)) {
      entry.restartCount = 0;
      this.start(channelId, channelUrl);
    }
  }

  /**
   * Remove a viewer from a channel.
   */
  removeViewer(channelId) {
    const entry = this.processes.get(channelId);
    if (!entry) return;
    entry.viewers = Math.max(0, entry.viewers - 1);

    if (entry.viewers === 0) {
      this.startIdleTimer(channelId);
    }
  }

  /**
   * Start idle timeout timer.
   */
  startIdleTimer(channelId) {
    const entry = this.processes.get(channelId);
    if (!entry) return;
    this.clearIdleTimer(channelId);

    const cfg = config.get();
    const idleSeconds = cfg.stream.idleStopSeconds || 60;

    entry.idleTimer = setTimeout(() => {
      logger.info(`FFmpeg: stopping ${channelId} (idle ${idleSeconds}s)`);
      this.stop(channelId);
    }, idleSeconds * 1000);
  }

  clearIdleTimer(channelId) {
    const entry = this.processes.get(channelId);
    if (entry && entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  /**
   * Stop FFmpeg for a channel.
   */
  stop(channelId) {
    const entry = this.processes.get(channelId);
    if (!entry) return;
    this.clearIdleTimer(channelId);
    entry.viewers = 0;

    if (entry.proc) {
      try {
        entry.proc.kill('SIGTERM');
        setTimeout(() => {
          if (entry.proc) {
            try { entry.proc.kill('SIGKILL'); } catch (_) {}
          }
        }, 5000);
      } catch (_) {}
    }
    entry.proc = null;
    entry.startedAt = null;
    this.processes.delete(channelId);
    logger.info(`FFmpeg: stopped ${channelId}`);
  }

  /**
   * Stop all processes.
   */
  stopAll() {
    for (const [channelId] of this.processes) {
      this.stop(channelId);
    }
  }

  /**
   * Get status of all processes.
   */
  getAllStatus() {
    const list = [];
    for (const [channelId, entry] of this.processes) {
      list.push(this.getStatus(channelId));
    }
    return list;
  }

  /**
   * Get status of a single process.
   */
  getStatus(channelId) {
    const entry = this.processes.get(channelId);
    if (!entry) return null;
    const running = entry.proc ? this.isRunning(entry.proc) : false;
    return {
      channelId: entry.channelId,
      isRunning: running,
      viewerCount: entry.viewers,
      uptime: entry.startedAt ? Math.floor((Date.now() - entry.startedAt.getTime()) / 1000) : 0,
      restartCount: entry.restartCount,
      currentUrl: entry.currentUrl
    };
  }

  /**
   * Get HLS playlist path for a channel.
   */
  getHlsPath(channelId) {
    const cfg = config.get();
    const hlsRoot = cfg.stream.hlsRoot || 'hls';
    return path.join(process.cwd(), hlsRoot, channelId, 'index.m3u8');
  }

  /**
   * Get HLS directory for a channel.
   */
  getHlsDir(channelId) {
    const cfg = config.get();
    const hlsRoot = cfg.stream.hlsRoot || 'hls';
    const dir = path.join(process.cwd(), hlsRoot, channelId);
    if (fs.existsSync(dir)) return dir;
    return null;
  }

  /**
   * Check if the HLS playlist exists and is ready for a channel.
   */
  isHlsReady(channelId) {
    const hlsPath = this.getHlsPath(channelId);
    try {
      if (fs.existsSync(hlsPath)) {
        const content = fs.readFileSync(hlsPath, 'utf8');
        // Check if playlist has at least one segment
        return content.includes('.ts');
      }
    } catch (_) {}
    return false;
  }

  /**
   * Wait for HLS playlist to be ready (polling).
   */
  waitForHls(channelId, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this.isHlsReady(channelId)) {
          return resolve(true);
        }
        if (Date.now() - start > timeoutMs) {
          return resolve(false);
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /**
   * Probe a stream URL using ffprobe.
   */
  probeStream(url) {
    return new Promise((resolve) => {
      const cfg = config.get();
      const ffprobePath = cfg.ffmpeg.ffprobePath || 'ffprobe';
      const startTime = Date.now();

      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        '-timeout', '10000000',
        url
      ];

      const proc = spawn(ffprobePath, args, { timeout: 15000, windowsHide: true });
      let stdout = '';
      let stderr = '';

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
            fps: vStream ? this.evalFps(vStream.r_frame_rate || vStream.avg_frame_rate) : null,
            audio: aStream ? aStream.codec_name : null,
            audioSampleRate: aStream ? aStream.sample_rate : null,
            bitrate: format.bit_rate ? parseInt(format.bit_rate) : null,
            latency: format.start_time || null,
            container: format.format_name || null,
            responseTime,
            error: null
          });
        } catch (_) {
          resolve({ isOnline: true, responseTime, error: 'Parse failed' });
        }
      });

      proc.on('error', (err) => {
        resolve({ isOnline: false, responseTime: Date.now() - startTime, error: err.message });
      });
    });
  }

  isRunning(proc) {
    try { return proc.exitCode === null; } catch (_) { return false; }
  }

  evalFps(fpsStr) {
    if (!fpsStr) return null;
    const parts = fpsStr.split('/');
    if (parts.length === 2) {
      const n = parseFloat(parts[0]), d = parseFloat(parts[1]);
      if (d && n) return Math.round((n / d) * 100) / 100;
    }
    return parseFloat(fpsStr) || null;
  }
}

module.exports = new FFmpegManager();