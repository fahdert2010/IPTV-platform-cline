'use strict';

/**
 * Utility functions used across the project.
 */

/**
 * Generate a short unique ID.
 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const map = { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' };
  return str.replace(/[&<>"']/g, c => map[c]);
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 */
function truncate(str, len = 100) {
  if (typeof str !== 'string') return '';
  if (str.length <= len) return str;
  return str.slice(0, len).trimEnd() + '...';
}

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Validate if a string is a valid URL.
 */
function isValidUrl(str) {
  if (typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract domain from a URL string.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Deep clone a plain object/array.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { uid, sleep, escapeHtml, truncate, formatBytes, isValidUrl, extractDomain, deepClone };