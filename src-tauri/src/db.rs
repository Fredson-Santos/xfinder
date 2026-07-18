use rusqlite::{Connection, Result};
use std::sync::Mutex;

/// Application database state managed by Tauri
pub struct DbState(pub Mutex<Connection>);

/// Initialise the database, create tables and FTS index.
pub fn init(path: &str) -> Result<DbState> {
    let conn = Connection::open(path)?;

    // Performance pragmas
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous   = NORMAL;
         PRAGMA foreign_keys  = ON;
         PRAGMA cache_size    = -8000;", // 8 MB cache
    )?;

    conn.execute_batch(SCHEMA)?;
    Ok(DbState(Mutex::new(conn)))
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA: &str = r#"
-- Servers table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    type                TEXT    NOT NULL,          -- 'xtream' | 'm3u'
    host                TEXT,
    port                TEXT,
    username            TEXT,
    password            TEXT,
    m3u_url             TEXT,
    expiry              TEXT,                       -- ISO date string
    active_connections  INTEGER,
    max_connections     INTEGER,
    status              TEXT    DEFAULT 'pending',  -- 'pending' | 'syncing' | 'ok' | 'error'
    last_sync           INTEGER,                    -- unix timestamp
    created_at          INTEGER DEFAULT (unixepoch())
);

-- Media table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id           INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    external_id         TEXT,                       -- stream_id or series_id on the server
    title               TEXT    NOT NULL,
    type                TEXT    NOT NULL,           -- 'movie' | 'series' | 'live'
    year                INTEGER,
    cover_url           TEXT,
    category            TEXT,
    stream_id           TEXT,                       -- numeric ID for URL construction
    container_extension TEXT,                       -- e.g. mp4, mkv, ts
    raw_url             TEXT                        -- full URL (used for M3U entries)
);

-- FTS5 virtual table for instant full-text search ------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
    title,
    content    = media,
    content_rowid = id
);

-- Triggers to keep FTS index in sync ------------------------------------------
CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media BEGIN
    INSERT INTO media_fts(rowid, title) VALUES (new.id, new.title);
END;

CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media BEGIN
    INSERT INTO media_fts(media_fts, rowid, title) VALUES ('delete', old.id, old.title);
END;

CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media BEGIN
    INSERT INTO media_fts(media_fts, rowid, title) VALUES ('delete', old.id, old.title);
    INSERT INTO media_fts(rowid, title) VALUES (new.id, new.title);
END;
"#;
