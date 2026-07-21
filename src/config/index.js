'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS_PATH = path.join(process.cwd(), 'config', 'default.json');
const USER_PATH = path.join(process.cwd(), 'config', 'user.json');

let cached = null;

/**
 * Load configuration with deep merge: defaults ← user overrides.
 * User config is optional; if missing, defaults are used.
 */
function load() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  let user = {};
  try {
    if (fs.existsSync(USER_PATH)) {
      user = JSON.parse(fs.readFileSync(USER_PATH, 'utf8'));
    }
  } catch (_) {
    // user config is optional
  }
  cached = deepMerge(defaults, user);
  return cached;
}

/**
 * Return current config (loads on first call).
 */
function get() {
  if (!cached) return load();
  return cached;
}

/**
 * Set a value by dot-notation key and persist to user.json.
 * Example: set('server.port', 8080)
 */
function set(key, value) {
  if (!cached) load();
  const keys = key.split('.');
  let target = cached;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
      target[keys[i]] = {};
    }
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  persist();
}

/**
 * Persist current config to user.json (only overrides, not full dump).
 */
function persist() {
  try {
    const dir = path.dirname(USER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USER_PATH, JSON.stringify(cached, null, 2), 'utf8');
  } catch (err) {
    console.error('Config: failed to persist', err.message);
  }
}

/**
 * Deep merge: source properties override target.
 */
function deepMerge(target, source) {
  const out = { ...target };
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      out[k] = deepMerge(out[k] || {}, source[k]);
    } else {
      out[k] = source[k];
    }
  }
  return out;
}

module.exports = { load, get, set, persist };