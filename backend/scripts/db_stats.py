import sqlite3
import os

db_path = "data/xfinder.db" if os.path.exists("data/xfinder.db") else os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "xfinder.db"))
conn = sqlite3.connect(db_path)
print("Servers by status:", conn.execute("SELECT status, count(*) FROM servers GROUP BY status").fetchall())
print("Media by type:", conn.execute("SELECT type, count(*) FROM media GROUP BY type").fetchall())
print("Distinct live titles:", conn.execute("SELECT count(DISTINCT lower(title)) FROM media WHERE type = 'live'").fetchone()[0])
print("Distinct movie titles:", conn.execute("SELECT count(DISTINCT lower(title)) FROM media WHERE type = 'movie'").fetchone()[0])
print("Distinct series titles:", conn.execute("SELECT count(DISTINCT lower(title)) FROM media WHERE type = 'series'").fetchone()[0])

