/**
 * XFinder — Electron Main Process
 *
 * Usa sql.js (SQLite → WebAssembly) para zero compilação nativa.
 * Replica todos os 7 comandos que antes eram Tauri/Rust.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import initSqlJs, { Database } from 'sql.js';
import * as m3u from './m3u';
import * as xtream from './xtream';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Server {
  id:                 number;
  name:               string;
  type:               string;
  host:               string | null;
  port:               string | null;
  username:           string | null;
  password:           string | null;
  m3u_url:            string | null;
  expiry:             string | null;
  active_connections: number | null;
  max_connections:    number | null;
  status:             string;
  last_sync:          number | null;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS servers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  type                TEXT    NOT NULL,
  host                TEXT,
  port                TEXT,
  username            TEXT,
  password            TEXT,
  m3u_url             TEXT,
  expiry              TEXT,
  active_connections  INTEGER,
  max_connections     INTEGER,
  status              TEXT    DEFAULT 'pending',
  last_sync           INTEGER,
  created_at          INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS media (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id           INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  external_id         TEXT,
  title               TEXT    NOT NULL,
  type                TEXT    NOT NULL,
  year                INTEGER,
  cover_url           TEXT,
  category            TEXT,
  stream_id           TEXT,
  container_extension TEXT,
  raw_url             TEXT
);


`;

// ─── DB state ────────────────────────────────────────────────────────────────

let db: Database;
let dbPath: string;

/** Persiste o banco em disco (sql.js é in-memory; precisa serializar). */
function saveDb(): void {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// ─── DB helpers (API similar a better-sqlite3) ───────────────────────────────

type SqlParam = string | number | null | undefined;

function dbAll(sql: string, params: SqlParam[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  stmt.bind(params as any);
  while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return rows;
}

function dbGet(sql: string, params: SqlParam[] = []): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params as any);
  const row = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
  stmt.free();
  return row;
}

function dbRun(sql: string, params: SqlParam[] = []): void {
  db.run(sql, params as any);
}

function lastInsertRowid(): number {
  const res = db.exec('SELECT last_insert_rowid()');
  return (res[0]?.values[0]?.[0] as number) ?? 0;
}

// ─── DB init ─────────────────────────────────────────────────────────────────

async function initDb(): Promise<void> {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });
  dbPath = path.join(userDataPath, 'xfinder.db');

  // Localiza o arquivo WASM do sql.js
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm.wasm')
    : path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  try { db.exec("DROP TABLE IF EXISTS media_fts"); } catch (e) {}
  db.exec(SCHEMA);
  saveDb();
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function unixTsToDate(s: string): string {
  const ts = parseInt(s, 10);
  if (!isNaN(ts)) return new Date(ts * 1000).toISOString().slice(0, 10);
  return s;
}

function yearFromStr(s: string): number | null {
  const y = parseInt(s.split('-')[0], 10);
  return isNaN(y) ? null : y;
}

// ─── Xtream sync ─────────────────────────────────────────────────────────────

async function syncXtream(server: Server): Promise<string> {
  const host = server.host ?? '';
  const port = server.port ?? '';
  const user = server.username ?? '';
  const pass = server.password ?? '';

  // Autenticar e obter metadados da conta
  const info = await xtream.getInfo(host, port, user, pass);

  if (info.user_info.exp_date) {
    const expiry     = unixTsToDate(info.user_info.exp_date);
    const activeCons = info.user_info.active_cons     ? parseInt(info.user_info.active_cons, 10)     : null;
    const maxCons    = info.user_info.max_connections ? parseInt(info.user_info.max_connections, 10) : null;
    dbRun(
      'UPDATE servers SET expiry = ?, active_connections = ?, max_connections = ? WHERE id = ?',
      [expiry, activeCons, maxCons, server.id],
    );
  }

  // Buscar VOD, séries e canais ao vivo em paralelo
  const [vodRes, seriesRes, liveRes] = await Promise.allSettled([
    xtream.getVod(host, port, user, pass),
    xtream.getSeries(host, port, user, pass),
    xtream.getLive(host, port, user, pass),
  ]);

  const vod    = vodRes.status    === 'fulfilled' ? vodRes.value    : [];
  const series = seriesRes.status === 'fulfilled' ? seriesRes.value : [];
  const live   = liveRes.status   === 'fulfilled' ? liveRes.value   : [];

  // Substituir entradas em uma única transação (atomicamente)
  db.exec('BEGIN');
  try {
    dbRun('DELETE FROM media WHERE server_id = ?', [server.id]);

    for (const v of vod) {
      const sid  = xtream.idToString(v.stream_id);
      const year = yearFromStr(v.releaseDate ?? '');
      dbRun(
        `INSERT INTO media (server_id, external_id, title, type, year, cover_url, category, stream_id, container_extension)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, ?)`,
        [server.id, sid, v.name, year, v.stream_icon ?? null, v.category_id ?? null, sid, v.container_extension ?? 'mp4'],
      );
    }

    for (const s of series) {
      const sid  = xtream.idToString(s.series_id);
      const year = yearFromStr(s.releaseDate ?? '');
      dbRun(
        `INSERT INTO media (server_id, external_id, title, type, year, cover_url, category, stream_id)
         VALUES (?, ?, ?, 'series', ?, ?, ?, ?)`,
        [server.id, sid, s.name, year, s.cover ?? null, s.category_id ?? null, sid],
      );
    }

    for (const l of live) {
      const sid = xtream.idToString(l.stream_id);
      dbRun(
        `INSERT INTO media (server_id, external_id, title, type, cover_url, category, stream_id, container_extension)
         VALUES (?, ?, ?, 'live', ?, ?, ?, 'ts')`,
        [server.id, sid, l.name, l.stream_icon ?? null, l.category_id ?? null, sid],
      );
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  saveDb();

  const total = vod.length + series.length + live.length;
  return `Synced ${total} items — Movies: ${vod.length}, Series: ${series.length}, Live: ${live.length}`;
}

// ─── M3U sync ────────────────────────────────────────────────────────────────

async function syncM3u(server: Server): Promise<string> {
  const url = server.m3u_url;
  if (!url) throw new Error('M3U URL is not set for this server');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let content: string;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    content = await res.text();
  } catch (e) {
    throw new Error(`Download error: ${e}`);
  } finally {
    clearTimeout(timer);
  }

  const entries = m3u.parse(content);

  db.exec('BEGIN');
  try {
    dbRun('DELETE FROM media WHERE server_id = ?', [server.id]);
    for (const entry of entries) {
      const mediaType = m3u.inferType(entry);
      dbRun(
        'INSERT INTO media (server_id, title, type, cover_url, category, raw_url) VALUES (?, ?, ?, ?, ?, ?)',
        [server.id, entry.title, mediaType, entry.logo ?? null, entry.group ?? null, entry.url],
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  saveDb();
  return `Synced ${entries.length} items from M3U`;
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function registerHandlers(): void {

  // list_servers
  ipcMain.handle('list_servers', () =>
    dbAll(`SELECT id, name, type, host, port, username, password, m3u_url, expiry,
                  active_connections, max_connections, status, last_sync
           FROM servers ORDER BY id`),
  );

  // add_server
  ipcMain.handle('add_server', (_, { name, serverType, host, port, username, password, m3uUrl }: {
    name: string; serverType: string;
    host?: string | null; port?: string | null;
    username?: string | null; password?: string | null;
    m3uUrl?: string | null;
  }) => {
    dbRun(
      `INSERT INTO servers (name, type, host, port, username, password, m3u_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [name, serverType, host ?? null, port ?? null, username ?? null, password ?? null, m3uUrl ?? null],
    );
    const id = lastInsertRowid();
    saveDb();
    return id;
  });

  // remove_server
  ipcMain.handle('remove_server', (_, { serverId }: { serverId: number }) => {
    dbRun('DELETE FROM servers WHERE id = ?', [serverId]);
    saveDb();
  });

  // sync_server
  ipcMain.handle('sync_server', async (_, { serverId }: { serverId: number }) => {
    const server = dbGet(
      `SELECT id, name, type, host, port, username, password, m3u_url, expiry,
              active_connections, max_connections, status, last_sync
       FROM servers WHERE id = ?`,
      [serverId],
    ) as Server | undefined;

    if (!server) throw new Error(`Server ${serverId} not found`);

    dbRun("UPDATE servers SET status = 'syncing' WHERE id = ?", [serverId]);
    saveDb();

    try {
      const result = server.type === 'xtream'
        ? await syncXtream(server)
        : server.type === 'm3u'
          ? await syncM3u(server)
          : (() => { throw new Error(`Unknown server type: ${server.type}`); })();

      dbRun(`UPDATE servers SET status = 'ok', last_sync = strftime('%s','now') WHERE id = ?`, [serverId]);
      saveDb();
      return result;
    } catch (e) {
      dbRun(`UPDATE servers SET status = 'error', last_sync = strftime('%s','now') WHERE id = ?`, [serverId]);
      saveDb();
      throw e;
    }
  });

  // search
  ipcMain.handle('search', (_, { query }: { query: string }) => {
    const q = (query ?? '').trim();
    if (!q) return [];

    const likeQuery = `%${q}%`;

    const rows = dbAll(`
      SELECT
        m.title               AS m_title,
        m.type                AS m_type,
        m.year                AS m_year,
        m.cover_url           AS m_cover_url,
        m.external_id         AS m_external_id,
        m.server_id           AS m_server_id,
        m.stream_id           AS m_stream_id,
        m.container_extension AS m_container_extension,
        m.raw_url             AS m_raw_url,
        s.name                AS s_name,
        s.type                AS s_type,
        s.host                AS s_host,
        s.port                AS s_port,
        s.username            AS s_username,
        s.password            AS s_password,
        s.expiry              AS s_expiry
      FROM media m
      JOIN servers s ON m.server_id = s.id
      WHERE m.title LIKE ?
        AND s.status = 'ok'
      LIMIT 300
    `, [likeQuery]);

    // Agrupa títulos iguais de múltiplos servidores
    const map = new Map<string, {
      title: string; type: string; year: number | null;
      cover_url: string | null; external_id: string | null;
      servers: unknown[];
    }>();

    for (const row of rows) {
      const title = row['m_title'] as string;
      const mtype = row['m_type']  as string;
      const key   = `${title.toLowerCase()}|${mtype}`;

      if (!map.has(key)) {
        map.set(key, {
          title,
          type:        mtype,
          year:        (row['m_year']        as number | null) ?? null,
          cover_url:   (row['m_cover_url']   as string | null) ?? null,
          external_id: (row['m_external_id'] as string | null) ?? null,
          servers: [],
        });
      }

      map.get(key)!.servers.push({
        server_id:           row['m_server_id'],
        server_name:         row['s_name'],
        server_type:         row['s_type'],
        host:                row['s_host'],
        port:                row['s_port'],
        username:            row['s_username'],
        password:            row['s_password'],
        stream_id:           row['m_stream_id'],
        container_extension: row['m_container_extension'],
        raw_url:             row['m_raw_url'],
        expiry:              row['s_expiry'],
      });
    }

    return [...map.values()];
  });

  // get_episodes
  ipcMain.handle('get_episodes', async (_, {
    serverType, host, port, username, password, seriesId,
  }: {
    serverType: string;
    host?:     string; port?:     string;
    username?: string; password?: string;
    seriesId:  string;
  }) => {
    if (serverType !== 'xtream') {
      throw new Error('Episode breakdown only available for Xtream servers');
    }
    return xtream.getSeriesInfo(
      host ?? '', port ?? '', username ?? '', password ?? '', seriesId,
    );
  });

  // open_stream
  ipcMain.handle('open_stream', async (_, { url }: { url: string }) => {
    await shell.openExternal(url);
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const appRoot   = app.getAppPath();
  const iconPath  = path.join(appRoot, 'src-tauri', 'icons', 'icon.ico');

  const win = new BrowserWindow({
    width:     960,
    height:    720,
    minWidth:  420,
    minHeight: 500,
    center:    true,
    title:     'XFinder',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile(path.join(appRoot, 'index.html'));
  win.setMenuBarVisibility(false);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initDb();
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
