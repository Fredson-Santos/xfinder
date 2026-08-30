/**
 * XFinder — Web Server
 *
 * Express server que expõe as mesmas 6 operações que eram IPC handlers
 * no Electron, agora como endpoints REST.
 * Usa sql.js (SQLite via WebAssembly) — mesma lib do projeto original,
 * sem compilação nativa.
 *
 * Variáveis de ambiente:
 *   PORT     — porta HTTP (padrão: 3000)
 *   HOST     — interface de rede (padrão: 0.0.0.0)
 *   DATA_DIR — diretório do banco de dados (padrão: ./data)
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import initSqlJs, { Database } from 'sql.js';
import * as m3u from './m3u';
import * as xtream from './xtream';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// ─── DB state ─────────────────────────────────────────────────────────────────

let db: Database;
let dbPath: string;

function saveDb(): void {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// ─── DB helpers (mesma API do main.ts original) ───────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_media_title  ON media(title);
CREATE INDEX IF NOT EXISTS idx_media_server ON media(server_id);
`;

// ─── DB init ─────────────────────────────────────────────────────────────────

async function initDb(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'xfinder.db');

  // Localiza o WASM do sql.js
  const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.exec(SCHEMA);
  saveDb();
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unixTsToDate(s: string): string {
  const ts = parseInt(s, 10);
  if (!isNaN(ts)) return new Date(ts * 1000).toISOString().slice(0, 10);
  return s;
}

function yearFromStr(s: string): number | null {
  const y = parseInt((s ?? '').split('-')[0], 10);
  return isNaN(y) ? null : y;
}

// ─── Xtream sync ──────────────────────────────────────────────────────────────

async function syncXtream(server: Server): Promise<string> {
  const host = server.host ?? '';
  const port = server.port ?? '';
  const user = server.username ?? '';
  const pass = server.password ?? '';

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

  const [vodRes, seriesRes, liveRes] = await Promise.allSettled([
    xtream.getVod(host, port, user, pass),
    xtream.getSeries(host, port, user, pass),
    xtream.getLive(host, port, user, pass),
  ]);

  const vod    = vodRes.status    === 'fulfilled' ? vodRes.value    : [];
  const series = seriesRes.status === 'fulfilled' ? seriesRes.value : [];
  const live   = liveRes.status   === 'fulfilled' ? liveRes.value   : [];

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

// ─── M3U sync ─────────────────────────────────────────────────────────────────

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

// ─── Express setup ────────────────────────────────────────────────────────────

function setupServer(): void {
  app.use(express.json());

  // Serve os arquivos estáticos do frontend
  const appRoot = path.join(__dirname, '..');
  app.use(express.static(appRoot, { index: 'index.html' }));

  const router = express.Router();

  // GET /api/servers
  router.get('/servers', (_req, res) => {
    res.json(dbAll(
      `SELECT id, name, type, host, port, username, password, m3u_url, expiry,
              active_connections, max_connections, status, last_sync
       FROM servers ORDER BY id`,
    ));
  });

  // POST /api/servers
  router.post('/servers', (req, res) => {
    const { name, serverType, host, port, username, password, m3uUrl } = req.body ?? {};
    if (!name || !serverType) {
      return void res.status(400).json({ error: 'name e serverType são obrigatórios' });
    }
    dbRun(
      `INSERT INTO servers (name, type, host, port, username, password, m3u_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [name, serverType, host ?? null, port ?? null, username ?? null, password ?? null, m3uUrl ?? null],
    );
    const id = lastInsertRowid();
    saveDb();
    res.json({ id });
  });

  // POST /api/servers/batch
  router.post('/servers/batch', (req, res) => {
    const { servers: list } = req.body ?? {};
    if (!Array.isArray(list) || list.length === 0) {
      return void res.status(400).json({ error: 'Nenhum servidor fornecido' });
    }

    const createdServers: { id: number; name: string }[] = [];
    db.exec('BEGIN');
    try {
      for (const item of list) {
        if (!item.name || !item.serverType) continue;
        dbRun(
          `INSERT INTO servers (name, type, host, port, username, password, m3u_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            item.name,
            item.serverType,
            item.host ?? null,
            item.port ?? null,
            item.username ?? null,
            item.password ?? null,
            item.m3uUrl ?? null,
          ],
        );
        const id = lastInsertRowid();
        createdServers.push({ id, name: item.name });
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      const msg = e instanceof Error ? e.message : String(e);
      return void res.status(500).json({ error: 'Falha ao importar servidores: ' + msg });
    }

    saveDb();
    res.json({ servers: createdServers, count: createdServers.length });
  });

  // DELETE /api/servers/:id
  router.delete('/servers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    dbRun('DELETE FROM servers WHERE id = ?', [id]);
    saveDb();
    res.json({ ok: true });
  });

  // POST /api/servers/:id/sync
  router.post('/servers/:id/sync', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const deleteOnError = req.query.deleteOnError === 'true' || req.body?.deleteOnError === true;
    const server = dbGet(
      `SELECT id, name, type, host, port, username, password, m3u_url, expiry,
              active_connections, max_connections, status, last_sync
       FROM servers WHERE id = ?`,
      [id],
    ) as Server | undefined;

    if (!server) return void res.status(404).json({ error: `Servidor ${id} não encontrado` });

    dbRun("UPDATE servers SET status = 'syncing' WHERE id = ?", [id]);
    saveDb();

    try {
      let result: string;
      if (server.type === 'xtream') {
        result = await syncXtream(server);
      } else if (server.type === 'm3u') {
        result = await syncM3u(server);
      } else {
        throw new Error(`Tipo de servidor desconhecido: ${server.type}`);
      }

      dbRun(`UPDATE servers SET status = 'ok', last_sync = strftime('%s','now') WHERE id = ?`, [id]);
      saveDb();
      res.json({ message: result });
    } catch (e: unknown) {
      if (deleteOnError) {
        dbRun('DELETE FROM servers WHERE id = ?', [id]);
      } else {
        dbRun(`UPDATE servers SET status = 'error', last_sync = strftime('%s','now') WHERE id = ?`, [id]);
      }
      saveDb();
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/search?q=...
  router.get('/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return void res.json([]);

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
          servers:     [],
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

    res.json([...map.values()]);
  });

  // GET /api/episodes?serverType=&host=&port=&username=&password=&seriesId=
  router.get('/episodes', async (req, res) => {
    const { serverType, host, port, username, password, seriesId } =
      req.query as Record<string, string>;

    if (serverType !== 'xtream') {
      return void res.status(400).json({ error: 'Detalhes de episódios disponíveis apenas para servidores Xtream' });
    }
    try {
      const data = await xtream.getSeriesInfo(
        host ?? '', port ?? '', username ?? '', password ?? '', seriesId ?? '',
      );
      res.json(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.use('/api', router);

  app.listen(PORT, HOST, () => {
    console.log(`\n  ✦ XFinder rodando com sucesso!`);
    console.log(`  ➜ Local:   http://localhost:${PORT}`);
    
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`  ➜ Rede (${name}): http://${iface.address}:${PORT}`);
          }
        }
      }
    } catch (e) {}

    console.log(`  ➜ Banco:   ${dbPath}`);
    console.log(`  Pressione Ctrl+C para parar.\n`);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

initDb()
  .then(setupServer)
  .catch(err => {
    console.error('Falha ao iniciar XFinder:', err);
    process.exit(1);
  });
