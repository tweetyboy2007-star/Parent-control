const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function init(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      channel_name TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      has_motion INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_channel_time ON recordings(channel_id, start_time);
    CREATE INDEX IF NOT EXISTS idx_recordings_start_time ON recordings(start_time);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      channel_name TEXT,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      thumbnail_path TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_events_channel_time ON events(channel_id, timestamp);

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY,
      name TEXT,
      rtsp TEXT,
      enabled INTEGER DEFAULT 1,
      brand TEXT,
      status TEXT DEFAULT 'offline',
      last_seen INTEGER
    );
  `);

  return db;
}

function insertRecording({ channelId, channelName, startTime, filePath }) {
  return db.prepare(`
    INSERT INTO recordings (channel_id, channel_name, start_time, file_path)
    VALUES (?, ?, ?, ?)
  `).run(channelId, channelName, startTime, filePath).lastInsertRowid;
}

function finalizeRecording(id, { endTime, fileSize, durationSeconds }) {
  db.prepare(`
    UPDATE recordings SET end_time=?, file_size=?, duration_seconds=? WHERE id=?
  `).run(endTime, fileSize, durationSeconds, id);
}

function searchRecordings({ channelIds, fromTime, toTime, limit = 200, offset = 0 }) {
  const channels = channelIds && channelIds.length ? channelIds : null;
  let sql = `SELECT * FROM recordings WHERE end_time IS NOT NULL`;
  const params = [];

  if (channels) {
    sql += ` AND channel_id IN (${channels.map(() => '?').join(',')})`;
    params.push(...channels);
  }
  if (fromTime) { sql += ` AND start_time >= ?`; params.push(fromTime); }
  if (toTime)   { sql += ` AND start_time <= ?`; params.push(toTime); }

  sql += ` ORDER BY start_time DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

function getRecordingById(id) {
  return db.prepare(`SELECT * FROM recordings WHERE id=?`).get(id);
}

function insertEvent({ channelId, channelName, eventType, timestamp, thumbnailPath, metadata }) {
  return db.prepare(`
    INSERT INTO events (channel_id, channel_name, event_type, timestamp, thumbnail_path, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(channelId, channelName, eventType, timestamp, thumbnailPath, JSON.stringify(metadata || {})).lastInsertRowid;
}

function searchEvents({ channelIds, fromTime, toTime, eventType, limit = 100, offset = 0 }) {
  let sql = `SELECT * FROM events WHERE 1=1`;
  const params = [];

  if (channelIds && channelIds.length) {
    sql += ` AND channel_id IN (${channelIds.map(() => '?').join(',')})`;
    params.push(...channelIds);
  }
  if (fromTime) { sql += ` AND timestamp >= ?`; params.push(fromTime); }
  if (toTime)   { sql += ` AND timestamp <= ?`; params.push(toTime); }
  if (eventType){ sql += ` AND event_type = ?`; params.push(eventType); }

  sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

function upsertChannelStatus(id, name, status) {
  db.prepare(`
    INSERT INTO channels (id, name, status, last_seen)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, last_seen=unixepoch()
  `).run(id, name, status);
}

function deleteOldRecordings(olderThanTimestamp) {
  const rows = db.prepare(`
    SELECT id, file_path FROM recordings WHERE start_time < ? AND end_time IS NOT NULL
  `).all(olderThanTimestamp);

  if (rows.length) {
    db.prepare(`DELETE FROM recordings WHERE start_time < ?`).run(olderThanTimestamp);
  }
  return rows;
}

function getStorageStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_recordings,
      SUM(file_size) as total_bytes,
      MIN(start_time) as oldest_recording,
      MAX(start_time) as newest_recording
    FROM recordings WHERE end_time IS NOT NULL
  `).get();
}

module.exports = {
  init,
  insertRecording,
  finalizeRecording,
  searchRecordings,
  getRecordingById,
  insertEvent,
  searchEvents,
  upsertChannelStatus,
  deleteOldRecordings,
  getStorageStats,
};
