'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * JSON file-based storage with atomic writes, backups, and restore.
 * Each collection is stored as a separate JSON file.
 */
class Storage {
  constructor() {
    this.cache = {};
    this.ensureDir(DATA_DIR);
    this.ensureDir(BACKUP_DIR);
  }

  // ─── Helpers ────────────────────────────────────────

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  collectionPath(name) {
    return path.join(DATA_DIR, `${name}.json`);
  }

  backupPath(name) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(BACKUP_DIR, `${name}-${ts}.json`);
  }

  // ─── CRUD ───────────────────────────────────────────

  /**
   * Return all documents in a collection.
   */
  getAll(collection) {
    if (this.cache[collection]) return this.cache[collection];
    const file = this.collectionPath(collection);
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        this.cache[collection] = JSON.parse(raw);
        if (!Array.isArray(this.cache[collection])) this.cache[collection] = [];
      } else {
        this.cache[collection] = [];
      }
    } catch (err) {
      logger.error(`Storage: failed to read ${collection}`, { error: err.message });
      this.cache[collection] = [];
    }
    return this.cache[collection];
  }

  /**
   * Get a single document by id.
   */
  getById(collection, id) {
    return this.getAll(collection).find(doc => doc.id === id) || null;
  }

  /**
   * Insert a new document.
   */
  insert(collection, doc) {
    const items = this.getAll(collection);
    if (!doc.id) doc.id = this.uid();
    doc.createdAt = new Date().toISOString();
    doc.updatedAt = doc.createdAt;
    items.push(doc);
    this.flush(collection);
    return doc;
  }

  /**
   * Update a document by id. Returns updated doc or null.
   */
  update(collection, id, patch) {
    const items = this.getAll(collection);
    const idx = items.findIndex(d => d.id === id);
    if (idx === -1) return null;
    patch.updatedAt = new Date().toISOString();
    items[idx] = { ...items[idx], ...patch, id };
    this.flush(collection);
    return items[idx];
  }

  /**
   * Delete a document by id. Returns true if deleted.
   */
  delete(collection, id) {
    const items = this.getAll(collection);
    const idx = items.findIndex(d => d.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    this.flush(collection);
    return true;
  }

  /**
   * Replace entire collection.
   */
  setAll(collection, docs) {
    this.cache[collection] = Array.isArray(docs) ? docs : [];
    this.flush(collection);
    return this.cache[collection];
  }

  // ─── Persistence ────────────────────────────────────

  /**
   * Write directly to file (with retry for Windows EPERM).
   */
  flush(collection) {
    const file = this.collectionPath(collection);
    const data = JSON.stringify(this.cache[collection] || [], null, 2);
    try {
      this.ensureDir(DATA_DIR);
      // Write directly instead of rename to avoid EPERM on Windows
      fs.writeFileSync(file, data, 'utf8');
    } catch (err) {
      // Retry once after a short delay (Windows file locking)
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
        setTimeout(() => {
          try { fs.writeFileSync(file, data, 'utf8'); } catch (_) {}
        }, 100);
      }
      logger.error(`Storage: flush failed for ${collection}`, { error: err.message });
    }
  }

  // ─── Backup & Restore ───────────────────────────────

  /**
   * Create a timestamped backup of a collection.
   */
  backup(collection) {
    const items = this.getAll(collection);
    const dest = this.backupPath(collection);
    try {
      this.ensureDir(BACKUP_DIR);
      fs.writeFileSync(dest, JSON.stringify(items, null, 2), 'utf8');
      logger.info(`Storage: backed up ${collection} (${items.length} docs)`);
      return dest;
    } catch (err) {
      logger.error(`Storage: backup failed for ${collection}`, { error: err.message });
      return null;
    }
  }

  /**
   * Restore a collection from its latest backup.
   */
  restore(collection) {
    const backups = this.listBackups(collection);
    if (backups.length === 0) {
      logger.warn(`Storage: no backups found for ${collection}`);
      return false;
    }
    const latest = backups[backups.length - 1];
    try {
      const raw = fs.readFileSync(latest, 'utf8');
      const docs = JSON.parse(raw);
      this.setAll(collection, docs);
      logger.info(`Storage: restored ${collection} from ${path.basename(latest)}`);
      return true;
    } catch (err) {
      logger.error(`Storage: restore failed for ${collection}`, { error: err.message });
      return false;
    }
  }

  /**
   * List backup files for a collection, sorted by date.
   */
  listBackups(collection) {
    try {
      this.ensureDir(BACKUP_DIR);
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith(collection + '-') && f.endsWith('.json'))
        .map(f => path.join(BACKUP_DIR, f))
        .sort();
      return files;
    } catch (_) {
      return [];
    }
  }

  // ─── Utility ────────────────────────────────────────

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

module.exports = new Storage();