import sqlite3
import time

conn = sqlite3.connect("data/xfinder.db")
for q, name in [
    ("SELECT min(m.id) AS id, m.title, m.cover_url, m.category, s.name AS server_name FROM media m JOIN servers s ON m.server_id = s.id WHERE m.type = 'live' AND s.status = 'ok' GROUP BY lower(m.title) ORDER BY m.title LIMIT 3000", "Live bulk"),
    ("SELECT min(m.id) AS id, m.title, m.cover_url, m.category, m.container_extension, s.name AS server_name FROM media m JOIN servers s ON m.server_id = s.id WHERE m.type = 'movie' AND s.status = 'ok' GROUP BY lower(m.title) ORDER BY m.title LIMIT 3000", "Movie bulk"),
    ("SELECT min(m.id) AS id, m.title, m.cover_url, m.category, m.year, s.name AS server_name FROM media m JOIN servers s ON m.server_id = s.id WHERE m.type = 'series' AND s.status = 'ok' GROUP BY lower(m.title) ORDER BY m.title LIMIT 2000", "Series bulk")
]:
    t0 = time.time()
    cur = conn.cursor()
    cur.execute(q)
    rows = cur.fetchall()
    print(f"{name}: {len(rows)} rows in {time.time()-t0:.3f}s")
