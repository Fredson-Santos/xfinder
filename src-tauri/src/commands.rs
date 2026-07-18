use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::{m3u, xtream};

// ─── Shared DTOs ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Server {
    pub id:                 i64,
    pub name:               String,
    pub r#type:             String,
    pub host:               Option<String>,
    pub port:               Option<String>,
    pub username:           Option<String>,
    pub password:           Option<String>,
    pub m3u_url:            Option<String>,
    pub expiry:             Option<String>,
    pub active_connections: Option<i64>,
    pub max_connections:    Option<i64>,
    pub status:             String,
    pub last_sync:          Option<i64>,
}

/// One occurrence of a title on a specific server (for the detail/watch view)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServerOccurrence {
    pub server_id:          i64,
    pub server_name:        String,
    pub server_type:        String,
    pub host:               Option<String>,
    pub port:               Option<String>,
    pub username:           Option<String>,
    pub password:           Option<String>,
    pub stream_id:          Option<String>,
    pub container_extension: Option<String>,
    pub raw_url:            Option<String>,
    pub expiry:             Option<String>,
}

/// Grouped search result (same title may appear on multiple servers)
#[derive(Serialize, Deserialize, Debug)]
pub struct SearchResult {
    pub title:       String,
    pub r#type:      String,
    pub year:        Option<i64>,
    pub cover_url:   Option<String>,
    pub external_id: Option<String>,
    pub servers:     Vec<ServerOccurrence>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn row_to_server(row: &rusqlite::Row) -> rusqlite::Result<Server> {
    Ok(Server {
        id:                 row.get(0)?,
        name:               row.get(1)?,
        r#type:             row.get(2)?,
        host:               row.get(3)?,
        port:               row.get(4)?,
        username:           row.get(5)?,
        password:           row.get(6)?,
        m3u_url:            row.get(7)?,
        expiry:             row.get(8)?,
        active_connections: row.get(9)?,
        max_connections:    row.get(10)?,
        status:             row.get(11)?,
        last_sync:          row.get(12)?,
    })
}

fn lock_err(e: impl std::fmt::Debug) -> String { format!("DB lock error: {:?}", e) }
fn db_err(e: impl std::fmt::Display)  -> String { format!("DB error: {}", e) }

// ─── list_servers ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_servers(state: State<DbState>) -> Result<Vec<Server>, String> {
    let conn = state.0.lock().map_err(lock_err)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, type, host, port, username, password, m3u_url, expiry,
                    active_connections, max_connections, status, last_sync
             FROM servers ORDER BY id",
        )
        .map_err(db_err)?;

    let result = stmt
        .query_map([], row_to_server)
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    result
}

// ─── add_server ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_server(
    state:       State<DbState>,
    name:        String,
    server_type: String,
    host:        Option<String>,
    port:        Option<String>,
    username:    Option<String>,
    password:    Option<String>,
    m3u_url:     Option<String>,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(lock_err)?;
    conn.execute(
        "INSERT INTO servers (name, type, host, port, username, password, m3u_url, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')",
        params![name, server_type, host, port, username, password, m3u_url],
    )
    .map_err(db_err)?;
    Ok(conn.last_insert_rowid())
}

// ─── remove_server ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn remove_server(state: State<DbState>, server_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(lock_err)?;
    conn.execute("DELETE FROM servers WHERE id = ?1", params![server_id])
        .map_err(db_err)?;
    Ok(())
}

// ─── sync_server ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_server(state: State<'_, DbState>, server_id: i64) -> Result<String, String> {
    // 1 — Read server config (hold lock briefly, then release)
    let server = {
        let conn = state.0.lock().map_err(lock_err)?;
        conn.query_row(
            "SELECT id, name, type, host, port, username, password, m3u_url, expiry,
                    active_connections, max_connections, status, last_sync
             FROM servers WHERE id = ?1",
            params![server_id],
            row_to_server,
        )
        .map_err(|_| format!("Server {} not found", server_id))?
    };

    // 2 — Mark as syncing
    {
        let conn = state.0.lock().map_err(lock_err)?;
        conn.execute(
            "UPDATE servers SET status = 'syncing' WHERE id = ?1",
            params![server_id],
        )
        .map_err(db_err)?;
    }

    // 3 — Do the actual sync (async, no lock held)
    let result = match server.r#type.as_str() {
        "xtream" => sync_xtream(&state, &server).await,
        "m3u"   => sync_m3u(&state, &server).await,
        t       => Err(format!("Unknown server type: {}", t)),
    };

    // 4 — Update status
    {
        let conn = state.0.lock().map_err(lock_err)?;
        let status = if result.is_ok() { "ok" } else { "error" };
        conn.execute(
            "UPDATE servers SET status = ?1, last_sync = unixepoch() WHERE id = ?2",
            params![status, server_id],
        )
        .map_err(db_err)?;
    }

    result
}

// ─── Xtream sync ─────────────────────────────────────────────────────────────

async fn sync_xtream(state: &State<'_, DbState>, server: &Server) -> Result<String, String> {
    let host = server.host.as_deref().unwrap_or("");
    let port = server.port.as_deref().unwrap_or("");
    let user = server.username.as_deref().unwrap_or("");
    let pass = server.password.as_deref().unwrap_or("");

    // Authenticate + get account metadata
    let info = xtream::get_info(host, port, user, pass).await?;

    // Persist expiry / connection limits
    if let Some(exp) = &info.user_info.exp_date {
        let expiry = unix_ts_to_date(exp);
        let conn = state.0.lock().map_err(lock_err)?;
        conn.execute(
            "UPDATE servers SET expiry = ?1, active_connections = ?2, max_connections = ?3 WHERE id = ?4",
            params![
                expiry,
                info.user_info.active_cons.as_deref().and_then(|v| v.parse::<i64>().ok()),
                info.user_info.max_connections.as_deref().and_then(|v| v.parse::<i64>().ok()),
                server.id
            ],
        )
        .map_err(db_err)?;
    }

    // Fetch VOD, series, live in parallel
    let (vod_res, series_res, live_res) = tokio::join!(
        xtream::get_vod(host, port, user, pass),
        xtream::get_series(host, port, user, pass),
        xtream::get_live(host, port, user, pass),
    );

    let vod    = vod_res.unwrap_or_default();
    let series = series_res.unwrap_or_default();
    let live   = live_res.unwrap_or_default();

    let counts = (vod.len(), series.len(), live.len());

    // Delete stale entries then batch-insert new ones
    {
        let conn = state.0.lock().map_err(lock_err)?;
        conn.execute("DELETE FROM media WHERE server_id = ?1", params![server.id])
            .map_err(db_err)?;

        conn.execute_batch("BEGIN").map_err(db_err)?;

        // VOD (movies)
        {
            let mut stmt = conn.prepare(
                "INSERT INTO media
                    (server_id, external_id, title, type, year, cover_url, category, stream_id, container_extension)
                 VALUES (?1, ?2, ?3, 'movie', ?4, ?5, ?6, ?7, ?8)",
            ).map_err(db_err)?;

            for v in &vod {
                let sid  = v.stream_id_str();
                let year = year_from_str(v.release_date.as_deref().unwrap_or(""));
                stmt.execute(params![
                    server.id, sid, v.name, year,
                    v.stream_icon, v.category_id, sid,
                    v.container_extension.as_deref().unwrap_or("mp4"),
                ])
                .map_err(db_err)?;
            }
        }

        // Series
        {
            let mut stmt = conn.prepare(
                "INSERT INTO media
                    (server_id, external_id, title, type, year, cover_url, category, stream_id)
                 VALUES (?1, ?2, ?3, 'series', ?4, ?5, ?6, ?7)",
            ).map_err(db_err)?;

            for s in &series {
                let sid  = s.series_id_str();
                let year = year_from_str(s.release_date.as_deref().unwrap_or(""));
                stmt.execute(params![
                    server.id, sid, s.name, year, s.cover, s.category_id, sid,
                ])
                .map_err(db_err)?;
            }
        }

        // Live
        {
            let mut stmt = conn.prepare(
                "INSERT INTO media
                    (server_id, external_id, title, type, cover_url, category, stream_id, container_extension)
                 VALUES (?1, ?2, ?3, 'live', ?4, ?5, ?6, 'ts')",
            ).map_err(db_err)?;

            for l in &live {
                let sid = l.stream_id_str();
                stmt.execute(params![
                    server.id, sid, l.name, l.stream_icon, l.category_id, sid,
                ])
                .map_err(db_err)?;
            }
        }

        conn.execute_batch("COMMIT").map_err(db_err)?;
    }

    Ok(format!(
        "Synced {} items — Movies: {}, Series: {}, Live: {}",
        counts.0 + counts.1 + counts.2,
        counts.0, counts.1, counts.2
    ))
}

// ─── M3U sync ────────────────────────────────────────────────────────────────

async fn sync_m3u(state: &State<'_, DbState>, server: &Server) -> Result<String, String> {
    let url = server
        .m3u_url
        .as_deref()
        .ok_or("M3U URL is not set for this server")?;

    // Download the playlist
    let content = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Read error: {}", e))?;

    let entries = m3u::parse(&content);
    let total   = entries.len();

    {
        let conn = state.0.lock().map_err(lock_err)?;
        conn.execute("DELETE FROM media WHERE server_id = ?1", params![server.id])
            .map_err(db_err)?;

        conn.execute_batch("BEGIN").map_err(db_err)?;

        let mut stmt = conn.prepare(
            "INSERT INTO media (server_id, title, type, cover_url, category, raw_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        ).map_err(db_err)?;

        for entry in &entries {
            let media_type = m3u::infer_type(entry);
            stmt.execute(params![
                server.id, entry.title, media_type,
                entry.logo, entry.group, entry.url,
            ])
            .map_err(db_err)?;
        }

        conn.execute_batch("COMMIT").map_err(db_err)?;
    }

    Ok(format!("Synced {} items from M3U", total))
}

// ─── search ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn search(state: State<DbState>, query: String) -> Result<Vec<SearchResult>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }

    let conn = state.0.lock().map_err(lock_err)?;

    // FTS5 prefix search: append * for starts-with matching
    let fts_query = format!("\"{}\"*", q.replace('"', ""));

    let mut stmt = conn
        .prepare(
            r#"SELECT
                m.title, m.type, m.year, m.cover_url, m.external_id,
                m.server_id, m.stream_id, m.container_extension, m.raw_url,
                s.name, s.type, s.host, s.port, s.username, s.password, s.expiry
               FROM media_fts fts
               JOIN media   m ON fts.rowid = m.id
               JOIN servers s ON m.server_id = s.id
               WHERE media_fts MATCH ?1
                 AND s.status = 'ok'
               ORDER BY rank
               LIMIT 300"#,
        )
        .map_err(db_err)?;

    let mut rows = stmt
        .query(params![fts_query])
        .map_err(db_err)?;

    // Group identical titles from multiple servers into one SearchResult
    let mut map: indexmap::IndexMap<String, SearchResult> = indexmap::IndexMap::new();

    while let Some(row) = rows.next().map_err(db_err)? {
        let title:   String = row.get(0).map_err(db_err)?;
        let mtype:   String = row.get(1).map_err(db_err)?;
        let key = format!("{}|{}", title.to_lowercase(), mtype);

        let year:        Option<i64>    = row.get(2).ok().flatten();
        let cover_url:   Option<String> = row.get(3).ok().flatten();
        let external_id: Option<String> = row.get(4).ok().flatten();

        let occ = ServerOccurrence {
            server_id:           row.get(5).map_err(db_err)?,
            stream_id:           row.get(6).ok().flatten(),
            container_extension: row.get(7).ok().flatten(),
            raw_url:             row.get(8).ok().flatten(),
            server_name:         row.get(9).map_err(db_err)?,
            server_type:         row.get(10).map_err(db_err)?,
            host:                row.get(11).ok().flatten(),
            port:                row.get(12).ok().flatten(),
            username:            row.get(13).ok().flatten(),
            password:            row.get(14).ok().flatten(),
            expiry:              row.get(15).ok().flatten(),
        };

        map.entry(key).or_insert_with(|| SearchResult {
            title:       title.clone(),
            r#type:      mtype.clone(),
            year,
            cover_url,
            external_id,
            servers:     vec![],
        }).servers.push(occ);
    }

    Ok(map.into_values().collect())
}

// ─── get_episodes ─────────────────────────────────────────────────────────────

/// Fetch season/episode list for a series on demand from the Xtream server.
#[tauri::command]
pub async fn get_episodes(
    server_type: String,
    host:        Option<String>,
    port:        Option<String>,
    username:    Option<String>,
    password:    Option<String>,
    series_id:   String,
) -> Result<serde_json::Value, String> {
    if server_type != "xtream" {
        return Err("Episode breakdown only available for Xtream servers".into());
    }
    xtream::get_series_info(
        host.as_deref().unwrap_or(""),
        port.as_deref().unwrap_or(""),
        username.as_deref().unwrap_or(""),
        password.as_deref().unwrap_or(""),
        &series_id,
    )
    .await
}

// ─── open_stream ─────────────────────────────────────────────────────────────

/// Open a stream URL in the system default browser / media player.
#[tauri::command]
pub async fn open_stream(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/// Convert a Unix timestamp string (as returned by Xtream) to an ISO date string.
fn unix_ts_to_date(s: &str) -> String {
    if let Ok(ts) = s.parse::<i64>() {
        use chrono::{DateTime, Utc};
        if let Some(dt) = DateTime::<Utc>::from_timestamp(ts, 0) {
            return dt.format("%Y-%m-%d").to_string();
        }
    }
    s.to_string() // return as-is if already a date string
}

/// Extract a 4-digit year from a date string like "2024-01-15".
fn year_from_str(s: &str) -> Option<i64> {
    s.split('-').next().and_then(|y| y.parse().ok())
}
