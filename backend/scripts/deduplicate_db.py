import sqlite3
import time
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

source_db = "data/xfinder_clean.db"
dedup_db = "data/xfinder_dedup.db"

if os.path.exists(dedup_db):
    os.remove(dedup_db)

print("✦ Iniciando desduplicação do banco de dados...")
t0 = time.time()

src_conn = sqlite3.connect(source_db)
src_conn.execute("PRAGMA journal_mode = WAL")

# Cria novo banco com índice UNIQUE
dst_conn = sqlite3.connect(dedup_db)
dst_conn.execute("PRAGMA journal_mode = MEMORY")
dst_conn.execute("PRAGMA synchronous = OFF")

# Copia schema de servers
dst_conn.executescript("""
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
  active_connections INTEGER,
  max_connections    INTEGER,
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

CREATE INDEX IF NOT EXISTS idx_media_server ON media(server_id);
CREATE INDEX IF NOT EXISTS idx_media_type_cat ON media(type, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_unique_content ON media(type, title COLLATE NOCASE);
""")

print("  Copiando tabela servers...")
servers = src_conn.execute("SELECT * FROM servers").fetchall()
dst_conn.executemany("INSERT INTO servers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", servers)
dst_conn.commit()

print("  Extraindo conteúdos únicos (desduplicados por type e title)...")
# Pega apenas 1 registro único por título e tipo
cur = src_conn.cursor()
cur.execute("""
    SELECT m.server_id, m.external_id, m.title, m.type, m.year, m.cover_url, m.category, m.stream_id, m.container_extension, m.raw_url
    FROM media m
    JOIN servers s ON m.server_id = s.id
    WHERE s.status = 'ok'
    GROUP BY m.type, lower(trim(m.title))
""")

batch = []
total_inserted = 0
for row in cur:
    batch.append(row)
    if len(batch) >= 10000:
        dst_conn.executemany("""
            INSERT OR IGNORE INTO media (server_id, external_id, title, type, year, cover_url, category, stream_id, container_extension, raw_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, batch)
        total_inserted += len(batch)
        batch = []

if batch:
    dst_conn.executemany("""
        INSERT OR IGNORE INTO media (server_id, external_id, title, type, year, cover_url, category, stream_id, container_extension, raw_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, batch)
    total_inserted += len(batch)

dst_conn.commit()
src_conn.close()

# Verifica integridade e tamanho
check = dst_conn.execute("PRAGMA integrity_check").fetchone()[0]
final_servers = dst_conn.execute("SELECT count(*) FROM servers").fetchone()[0]
final_media = dst_conn.execute("SELECT count(*) FROM media").fetchone()[0]
dst_conn.close()

# Otimiza arquivo final
final_clean = "data/xfinder_unique.db"
if os.path.exists(final_clean):
    os.remove(final_clean)

opt_conn = sqlite3.connect(dedup_db)
opt_conn.execute(f"VACUUM INTO '{final_clean}'")
opt_conn.close()
os.remove(dedup_db)

size_mb = os.path.getsize(final_clean) / (1024 * 1024)
print(f"✦ Desduplicação concluída em {time.time()-t0:.2f}s!")
print(f"  Integridade: {check}")
print(f"  Servidores: {final_servers}")
print(f"  Mídias Únicas: {final_media} (eliminados {1091882 - final_media} duplicados!)")
print(f"  Tamanho do Banco: {size_mb:.2f} MB (redução de 266MB para {size_mb:.2f}MB!)")
