import sqlite3
import threading
from pathlib import Path
from playout import config

_local = threading.local()

def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(str(config.DB_PATH), detect_types=sqlite3.PARSE_DECLTYPES)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.conn = c
    return _local.conn

def get() -> sqlite3.Connection:
    return _conn()

def init():
    c = _conn()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS movies (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        year         INTEGER,
        genre        TEXT,
        duration_secs INTEGER NOT NULL DEFAULT 5400,
        file_path    TEXT,
        description  TEXT,
        rating       REAL DEFAULT 0.0,
        ai_enriched  INTEGER DEFAULT 0,
        added_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id  INTEGER NOT NULL,
        movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        start_time  TEXT NOT NULL,
        end_time    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'scheduled',
        created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sched_ch_start ON schedules(channel_id, start_time);

    CREATE TABLE IF NOT EXISTS playout_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER,
        level      TEXT DEFAULT 'INFO',
        event      TEXT NOT NULL,
        detail     TEXT,
        ts         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type   TEXT NOT NULL,
        channel_id  INTEGER,
        payload     TEXT,
        status      TEXT NOT NULL DEFAULT 'pending',
        result      TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS health_reports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        summary    TEXT NOT NULL,
        severity   TEXT NOT NULL DEFAULT 'OK',
        detail     TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
    """)
    c.commit()
