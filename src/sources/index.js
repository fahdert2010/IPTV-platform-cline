'use strict';

const storage = require('../storage');
const logger = require('../logger');
const { parseM3U, parseM3UFile, parseM3UUrl } = require('./m3u-parser');
const channels = require('../channels');

const COLLECTION = 'sources';

/**
 * Sources Manager — Full CRUD + M3U import + sync.
 */
class SourcesManager {
  getAll() {
    return storage.getAll(COLLECTION);
  }

  getById(id) {
    return storage.getById(COLLECTION, id);
  }

  add(data) {
    const source = {
      name: data.name || 'New Source',
      type: data.type || 'm3u_url', // m3u_file | m3u_url | single
      url: data.url || '',
      enabled: data.enabled !== false,
      lastImport: null,
      channelCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const created = storage.insert(COLLECTION, source);
    logger.info(`Sources: created "${created.name}" (${created.type})`);
    return created;
  }

  update(id, patch) {
    patch.updatedAt = new Date().toISOString();
    const updated = storage.update(COLLECTION, id, patch);
    if (updated) logger.info(`Sources: updated "${updated.name}"`);
    return updated;
  }

  remove(id) {
    const deleted = storage.delete(COLLECTION, id);
    if (deleted) logger.info(`Sources: deleted ${id}`);
    return deleted;
  }

  /**
   * Import channels from a specific source.
   * Parses M3U and inserts channels into the Channels module.
   * Returns { imported, added, skipped, channels }
   */
  async importChannels(source) {
    logger.info(`Sources: importing from "${source.name}" (${source.type})`);

    let parsed = [];

    try {
      if (source.type === 'm3u_file') {
        parsed = parseM3UFile(source.url);
      } else if (source.type === 'm3u_url') {
        parsed = await parseM3UUrl(source.url);
      } else if (source.type === 'single') {
        parsed = [{
          name: source.name,
          url: source.url,
          tvgId: '',
          tvgName: source.name,
          tvgLogo: '',
          group: 'General',
          backupUrls: []
        }];
      }
    } catch (err) {
      logger.error(`Sources: import failed for "${source.name}"`, { error: err.message });
      return { imported: 0, added: 0, skipped: 0, channels: [] };
    }

    // Mark each channel with sourceId
    for (const ch of parsed) {
      ch.sourceId = source.id;
    }

    // Bulk add to channels module (deduplicates by URL)
    const result = channels.bulkAdd(parsed);

    // Update source metadata
    this.update(source.id, {
      lastImport: new Date().toISOString(),
      channelCount: result.added
    });

    logger.info(`Sources: imported ${parsed.length} from "${source.name}", added ${result.added}, skipped ${result.skipped}`);
    return { imported: parsed.length, ...result };
  }

  /**
   * Import all enabled sources.
   */
  async importAllEnabled() {
    const enabled = this.getAll().filter(s => s.enabled);
    let totalImported = 0;
    let totalAdded = 0;
    let totalSkipped = 0;
    const allChannels = [];

    for (const source of enabled) {
      const result = await this.importChannels(source);
      totalImported += result.imported;
      totalAdded += result.added;
      totalSkipped += result.skipped;
      allChannels.push(...result.channels);
    }

    return { imported: totalImported, added: totalAdded, skipped: totalSkipped, channels: allChannels };
  }

  /**
   * Resync a source: re-import and replace its channels.
   */
  async resync(id) {
    const source = this.getById(id);
    if (!source) return null;

    // Remove old channels from this source
    const existingChannels = channels.getAll().filter(c => c.sourceId === id);
    for (const ch of existingChannels) {
      channels.remove(ch.id);
    }

    // Re-import
    return await this.importChannels(source);
  }
}

module.exports = new SourcesManager();