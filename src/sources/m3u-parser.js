'use strict';

const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const logger = require('../logger');

/**
 * Parse M3U/M3U8 playlist content into channel entries.
 * Supports #EXTINF with tvg-id, tvg-name, tvg-logo, group-title.
 */
function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      current = parseExtinf(line);
      continue;
    }

    if (current && !line.startsWith('#')) {
      channels.push({
        name: current.name,
        url: line,
        tvgId: current.tvgId,
        tvgName: current.tvgName,
        tvgLogo: current.tvgLogo,
        group: current.group,
        backupUrls: []
      });
      current = null;
    }
  }

  return channels;
}

/**
 * Parse a single #EXTINF line.
 * Example: #EXTINF:-1 tvg-id="1471" tvg-name="beIN MAX 1" tvg-logo="..." group-title="Sports",beIN MAX 1
 */
function parseExtinf(line) {
  const result = { tvgId: '', tvgName: '', tvgLogo: '', group: '', name: '' };

  const idMatch = line.match(/tvg-id="([^"]*)"/);
  if (idMatch) result.tvgId = idMatch[1];

  const nameMatch = line.match(/tvg-name="([^"]*)"/);
  if (nameMatch) result.tvgName = nameMatch[1];

  const logoMatch = line.match(/tvg-logo="([^"]*)"/);
  if (logoMatch) result.tvgLogo = logoMatch[1];

  const groupMatch = line.match(/group-title="([^"]*)"/);
  if (groupMatch) result.group = groupMatch[1];

  const lastComma = line.lastIndexOf(',');
  if (lastComma !== -1) {
    result.name = line.slice(lastComma + 1).trim();
  }

  return result;
}

/**
 * Parse M3U from a local file.
 */
function parseM3UFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const channels = parseM3U(content);
    logger.info(`M3U Parser: loaded ${channels.length} channels from ${filePath}`);
    return channels;
  } catch (err) {
    logger.error(`M3U Parser: failed to read file ${filePath}`, { error: err.message });
    return [];
  }
}

/**
 * Fetch and parse M3U from a remote URL.
 */
function parseM3UUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        logger.warn(`M3U Parser: HTTP ${res.statusCode} from ${url}`);
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(parseM3UUrl(new URL(res.headers.location, url).href));
        }
        return resolve([]);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const channels = parseM3U(data);
        logger.info(`M3U Parser: fetched ${channels.length} channels from ${url}`);
        resolve(channels);
      });
    });
    req.on('error', (err) => {
      logger.error(`M3U Parser: failed to fetch ${url}`, { error: err.message });
      resolve([]);
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

module.exports = { parseM3U, parseM3UFile, parseM3UUrl, parseExtinf };