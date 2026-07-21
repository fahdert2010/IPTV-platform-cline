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
    memoryBuffer.push(line);
    if (memoryBuffer.length > 1000) memoryBuffer.shift();
  }
}

const logger = {
  error: (msg, meta) => write(0, msg, meta),
  warn: (msg, meta) => write(1, msg, meta),
  info: (msg, meta) => write(2, msg, meta),
  debug: (msg, meta) => write(3, msg, meta),

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