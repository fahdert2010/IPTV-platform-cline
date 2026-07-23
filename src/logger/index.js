'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const LOG_DIR = path.join(process.cwd(), 'logs');

const LEVEL_MAP = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m'
};

let fileStream = null;
let currentDate = null;
let memoryBuffer = [];

/**
 * Ensure log directory exists.
 */
function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Get today's log file path.
 */
function logFilePath() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `mubasher-${d}.log`);
}

/**
 * Rotate log file daily.
 */
function rotate() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDate) {
    if (fileStream) fileStream.end();
    ensureDir();
    fileStream = fs.createWriteStream(logFilePath(), { flags: 'a' });
    currentDate = today;
  }
}

/**
 * Format a log entry.
 */
function format(level, message, meta) {
  const ts = new Date().toISOString();
  const levelName = LEVEL_NAMES[level] || 'INFO';
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${levelName}] ${message}${metaStr}`;
}

/**
 * Core log function.
 */
function write(level, message, meta) {
  const cfg = config.get();
  const configuredLevel = LEVEL_MAP[cfg.log.level] !== undefined ? LEVEL_MAP[cfg.log.level] : 2;
  if (level > configuredLevel) return;

  const line = format(level, message, meta);

  // Console output
  if (cfg.log.console !== false) {
    const color = COLORS[LEVEL_NAMES[level]?.toLowerCase()] || COLORS.reset;
    console.log(`${color}${line}${COLORS.reset}`);
  }

  // File output
  if (cfg.log.file !== false) {
    try {
      rotate();
      fileStream.write(line + '\n');
    } catch (_) {
      // silent
    }
  }

  // Memory buffer
  if (cfg.log.memory) {
    memoryBuffer.push({ level: LEVEL_NAMES[level]?.toLowerCase() || 'info', message, meta, timestamp: new Date().toISOString() });
    const maxLines = cfg.log.memoryLines || 5000;
    if (memoryBuffer.length > maxLines) memoryBuffer.shift();
  }
}

/**
 * Helper to format a separator line.
 */
function separator(title) {
  return `\n${'─'.repeat(20)} ${title} ${'─'.repeat(20)}`;
}

const logger = {
  error: (msg, meta) => write(0, msg, meta),
  warn: (msg, meta) => write(1, msg, meta),
  info: (msg, meta) => write(2, msg, meta),
  debug: (msg, meta) => write(3, msg, meta),

  // ════════════════════════════════════════════════════════════
  // HLS LIFECYCLE LOGGING
  // ════════════════════════════════════════════════════════════

  /**
   * Log stream start event.
   */
  logStreamStart: (channelId, outputDir, ffmpegPid, outputPath) => {
    logger.info(
      `\n${separator('STREAM START')}\n` +
      `Channel ID: ${channelId}\n` +
      `Output Directory: ${outputDir}\n` +
      `FFmpeg PID: ${ffmpegPid}\n` +
      `Output Path: ${outputPath}`
    );
  },

  /**
   * Log playlist creation event.
   */
  logPlaylistCreated: (channelId, m3u8Path, mtime, size) => {
    logger.info(
      `\n${separator('PLAYLIST CREATED')}\n` +
      `Channel ID: ${channelId}\n` +
      `index.m3u8 exists: ${fs.existsSync(m3u8Path)}\n` +
      `mtime: ${mtime}\n` +
      `size: ${size} bytes`
    );
  },

  /**
   * Log playlist update event.
   */
  logPlaylistUpdated: (channelId, sequence, segmentCount) => {
    logger.info(
      `\n${separator('PLAYLIST UPDATED')}\n` +
      `Channel ID: ${channelId}\n` +
      `sequence: ${sequence}\n` +
      `segment count: ${segmentCount}`
    );
  },

  /**
   * Log client HTTP request for HLS file.
   */
  logClientRequest: (method, url, filePath, exists, absolutePath) => {
    logger.info(
      `\n${separator('CLIENT REQUEST')}\n` +
      `METHOD: ${method}\n` +
      `URL: ${url}\n` +
      `GET ${filePath}\n` +
      `exists? ${exists}\n` +
      `absolute path: ${absolutePath}`
    );
  },

  /**
   * Log FFmpeg exit event.
   */
  logFfmpegExit: (channelId, exitCode, signal, reason) => {
    logger.info(
      `\n${separator('FFMPEG EXIT')}\n` +
      `Channel ID: ${channelId}\n` +
      `exit code: ${exitCode}\n` +
      `signal: ${signal}\n` +
      `reason: ${reason}`
    );
  },

  /**
   * Log stream stop event.
   */
  logStreamStop: (channelId, reason) => {
    logger.info(
      `\n${separator('STREAM STOP')}\n` +
      `Channel ID: ${channelId}\n` +
      `reason: ${reason}`
    );
  },

  /**
   * Log directory delete event with stack trace.
   */
  logDirectoryDelete: (channelId, deletedPath, caller) => {
    // Capture stack trace
    const stack = new Error().stack;
    logger.info(
      `\n${separator('DIRECTORY DELETE')}\n` +
      `Channel ID: ${channelId}\n` +
      `who called delete: ${caller}\n` +
      `stack trace:\n${stack}\n` +
      `deleted path: ${deletedPath}`
    );
  },

  /**
   * Log playlist missing at request time.
   */
  logPlaylistMissing: (channelId, absolutePath, exists, cwd) => {
    logger.info(
      `\n${separator('PLAYLIST MISSING')}\n` +
      `Channel ID: ${channelId}\n` +
      `absolute path searched: ${absolutePath}\n` +
      `exists? ${exists}\n` +
      `cwd: ${cwd}`
    );
  },

  /**
   * Return recent log lines from memory buffer.
   */
  getBuffer: () => [...memoryBuffer],

  /**
   * Flush and close file stream.
   */
  close: () => {
    if (fileStream) {
      fileStream.end();
      fileStream = null;
    }
  }
};

module.exports = logger;