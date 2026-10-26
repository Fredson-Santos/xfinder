import sqlite3
import os

clean_path = "data/xfinder_clean.db"
if os.path.exists(clean_path):
    os.remove(clean_path)

conn = sqlite3.connect("data/xfinder.db")
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.execute("VACUUM INTO 'data/xfinder_clean.db'")
conn.close()

conn2 = sqlite3.connect(clean_path)
check = conn2.execute("PRAGMA integrity_check").fetchone()[0]
servers = conn2.execute("SELECT count(*) FROM servers").fetchone()[0]
media = conn2.execute("SELECT count(*) FROM media").fetchone()[0]
size = os.path.getsize(clean_path) / (1024 * 1024)
print(f"Clean DB -> Integrity: {check}, Servers: {servers}, Media: {media}, Size: {size:.2f} MB")
conn2.close()
