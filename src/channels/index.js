'use strict';

const storage = require('../storage');
const logger = require('../logger');

const COLLECTION = 'channels';

/**
 * Channels Manager — Full CRUD + bulk import + group management.
 */
class ChannelsManager {
  getAll() {
    return storage.getAll(COLLECTION);
  }

  getById(id) {
    return storage.getById(COLLECTION, id);
  }

  add(data) {
    const channel = {
      name: data.name || 'Unknown',
      url: data.url || '',
      backupUrls: data.backupUrls || [],
      tvgId: data.tvgId || '',
      tvgLogo: data.tvgLogo || '',
      group: data.group || 'General',
      sourceId: data.sourceId || '',
      enabled: data.enabled !== false,
      status: 'idle', // idle | streaming | error | blocked
      viewers: 0,
      health: null,
      cacheFolder: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const created = storage.insert(COLLECTION, channel);
    return created;
  }

  update(id, patch) {
    patch.updatedAt = new Date().toISOString();
    return storage.update(COLLECTION, id, patch);
  }

  remove(id) {
    return storage.delete(COLLECTION, id);
  }

  /**
   * Bulk add channels, skipping duplicates by URL.
   * Returns { added, skipped, channels }
   */
  bulkAdd(channelList) {
    const existing = this.getAll();
    const existingUrls = new Set(existing.map(c => c.url));
    let added = 0;
    let skipped = 0;
    const addedChannels = [];

    for (const ch of channelList) {
      if (!ch.url) { skipped++; continue; }
      if (existingUrls.has(ch.url)) { skipped++; continue; }

      const created = this.add(ch);
      existingUrls.add(ch.url);
      added++;
      addedChannels.push(created);
    }

    logger.info(`Channels: bulk added ${added}, skipped ${skipped}`);
    return { added, skipped, channels: addedChannels };
  }

  /**
   * Get channels by group name.
   */
  getByGroup(group) {
    return this.getAll().filter(c => c.group === group && c.enabled);
  }

  /**
   * Get all unique group names.
   */
  getGroups() {
    const groups = new Set();
    for (const ch of this.getAll()) {
      if (ch.group) groups.add(ch.group);
    }
    return [...groups].sort();
  }

  /**
   * Get the primary active URL for a channel.
   */
  getActiveUrl(channel) {
    if (!channel) return null;
    return channel.url;
  }

  /**
   * Get next backup URL for failover (round-robin).
   */
  getNextBackupUrl(channel, currentUrl) {
    if (!channel || !channel.backupUrls || channel.backupUrls.length === 0) return null;
    const idx = channel.backupUrls.indexOf(currentUrl);
    if (idx === -1) return channel.backupUrls[0];
    return channel.backupUrls[(idx + 1) % channel.backupUrls.length];
  }

  /**
   * Search channels by name or group.
   */
  search(query) {
    const q = query.toLowerCase();
    return this.getAll().filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.tvgId.toLowerCase().includes(q)
    );
  }

  /**
   * Get channels from a specific source.
   */
  getBySource(sourceId) {
    return this.getAll().filter(c => c.sourceId === sourceId);
  }
}

module.exports = new ChannelsManager();