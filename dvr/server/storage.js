const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('./database');

class StorageManager {
  constructor(config) {
    this.recordingsDir = config.storage.recordingsDir;
    this.maxDiskUsagePercent = config.storage.maxDiskUsagePercent || 90;
    this.retentionDays = config.storage.retentionDays || 30;

    [this.recordingsDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  getChannelDir(channelId, date) {
    const d = date || new Date();
    const dateStr = d.toISOString().slice(0, 10);
    const dir = path.join(this.recordingsDir, `ch${channelId}`, dateStr);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  buildSegmentPath(channelId) {
    const now = new Date();
    const dir = this.getChannelDir(channelId, now);
    const timeStr = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
    return path.join(dir, `${timeStr}.mp4`);
  }

  getDiskUsage() {
    try {
      const output = execSync(`df -k "${this.recordingsDir}" | tail -1`, { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      const usedKb = parseInt(parts[2]);
      const availKb = parseInt(parts[3]);
      const totalKb = usedKb + availKb;
      const percent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
      return { usedKb, availKb, totalKb, percent };
    } catch {
      return { usedKb: 0, availKb: 999999999, totalKb: 999999999, percent: 0 };
    }
  }

  async enforceRetention() {
    const cutoff = Math.floor(Date.now() / 1000) - (this.retentionDays * 86400);
    const oldRows = db.deleteOldRecordings(cutoff);

    let deletedBytes = 0;
    for (const row of oldRows) {
      try {
        const stat = fs.statSync(row.file_path);
        deletedBytes += stat.size;
        fs.unlinkSync(row.file_path);
        this._cleanEmptyDirs(path.dirname(row.file_path));
      } catch { /* file already gone */ }
    }

    if (oldRows.length > 0) {
      console.log(`[Storage] Retention cleanup: removed ${oldRows.length} files, freed ${(deletedBytes / 1e9).toFixed(2)} GB`);
    }
    return oldRows.length;
  }

  async enforceDiskLimit() {
    const usage = this.getDiskUsage();
    if (usage.percent < this.maxDiskUsagePercent) return 0;

    console.log(`[Storage] Disk at ${usage.percent}%, enforcing disk limit...`);

    // Delete oldest recordings first
    const oldest = db.searchRecordings({ limit: 50, offset: 0 });
    let deletedCount = 0;

    for (const rec of oldest.reverse()) {
      const currentUsage = this.getDiskUsage();
      if (currentUsage.percent < this.maxDiskUsagePercent - 5) break;

      try {
        fs.unlinkSync(rec.file_path);
        db.deleteOldRecordings(rec.start_time + 1);
        this._cleanEmptyDirs(path.dirname(rec.file_path));
        deletedCount++;
      } catch { /* ignore */ }
    }

    return deletedCount;
  }

  getFileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  listRecordingsOnDisk(channelId, dateStr) {
    const dir = path.join(this.recordingsDir, `ch${channelId}`, dateStr);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({
        file: path.join(dir, f),
        name: f,
        timestamp: this._parseTimestampFromFilename(f),
        size: this.getFileSize(path.join(dir, f)),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getDatesWithRecordings(channelId) {
    const channelDir = path.join(this.recordingsDir, `ch${channelId}`);
    if (!fs.existsSync(channelDir)) return [];

    return fs.readdirSync(channelDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
  }

  _parseTimestampFromFilename(filename) {
    // Format: 2024-01-15_14-30-00.mp4
    const match = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
    if (!match) return 0;
    const dt = match[1] + 'T' + match[2].replace(/-/g, ':');
    return Math.floor(new Date(dt).getTime() / 1000);
  }

  _cleanEmptyDirs(dir) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        this._cleanEmptyDirs(path.dirname(dir));
      }
    } catch { /* ignore */ }
  }
}

module.exports = StorageManager;
