import re
import os
import sys
import json
import time
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "xfinder.db")
SOURCE_FILE = r"c:\Users\Fred\Projetos\Study\links_servidores_completos.txt"

def parse_source():
    if not os.path.exists(SOURCE_FILE):
        print(f"Arquivo não encontrado: {SOURCE_FILE}")
        return []

    with open(SOURCE_FILE, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    # Regex para capturar os links e a data de expiração
    # Exemplo: http://praia13.com/get.php?username=Eliroberto10&password=HRTv12345&type=m3u_plus [Expiração: 28/03/2027]
    pattern = re.compile(
        r'(https?://[^/:\s]+(?::\d+)?)/get\.php\?username=([^&\s]+)&password=([^&\s]+)[^\n\[]*\[Expiração:\s*(\d{2}/\d{2}/\d{4})\]',
        re.IGNORECASE
    )

    items = []
    seen = set()
    today = datetime.now().date()

    for match in pattern.finditer(content):
        full_url, user, pwd, exp_str = match.groups()
        parsed = urllib.parse.urlparse(full_url)
        host = f"{parsed.scheme}://{parsed.hostname}"
        port = str(parsed.port) if parsed.port else None
        
        try:
            exp_date = datetime.strptime(exp_str, "%d/%m/%Y").date()
        except Exception:
            continue

        # Filtra já expiradas pela data informada no texto
        if exp_date < today:
            continue

        key = (host, port, user, pwd)
        if key in seen:
            continue
        seen.add(key)

        items.append({
            "host": host,
            "port": port,
            "username": user,
            "password": pwd,
            "expiry": exp_date.strftime("%Y-%m-%d"),
            "full_url": full_url
        })

    return items

def test_account(item):
    host = item["host"]
    port = item["port"]
    user = item["username"]
    pwd = item["password"]
    
    base = f"{host}:{port}" if port else host
    api_url = f"{base}/player_api.php?username={user}&password={pwd}"
    
    req = urllib.request.Request(
        api_url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            if resp.status != 200:
                return None
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            uinfo = data.get("user_info", {})
            auth = uinfo.get("auth")
            status = str(uinfo.get("status", "")).lower()
            
            if (auth == 1 or auth == "1") and status != "expired" and status != "disabled":
                exp_ts = uinfo.get("exp_date")
                if exp_ts and str(exp_ts).isdigit():
                    val = int(exp_ts)
                    if val > 0 and val < time.time():
                        return None # expirado no servidor
                    real_exp = datetime.fromtimestamp(val).strftime("%Y-%m-%d")
                    item["expiry"] = real_exp
                
                item["max_connections"] = uinfo.get("max_connections")
                item["active_cons"] = uinfo.get("active_cons")
                item["server_name"] = urllib.parse.urlparse(host).hostname
                return item
    except Exception:
        return None
    return None

def main():
    print("✦ Analisando listas do arquivo de servidores...")
    items = parse_source()
    print(f"Total de links com data futura no arquivo: {len(items)}")

    print(f"✦ Testando autenticação real das contas (timeout 6s)...")
    valid_accounts = []
    with ThreadPoolExecutor(max_workers=25) as executor:
        futures = {executor.submit(test_account, it): it for it in items}
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                valid_accounts.append(res)
                print(f"  [ONLINE & VÁLIDO] {res['host']} | Usuário: {res['username']} | Expira em: {res['expiry']}")

    print(f"\n✦ Total de contas REAIS e VÁLIDAS encontradas: {len(valid_accounts)}")

    if not valid_accounts:
        print("Nenhuma conta válida online.")
        return

    # Inserção no banco SQLite local
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    inserted = 0
    updated = 0
    for acc in valid_accounts:
        # Verifica se já existe
        cur.execute(
            "SELECT id FROM servers WHERE host = ? AND (port = ? OR (port IS NULL AND ? IS NULL)) AND username = ?",
            (acc["host"], acc["port"], acc["port"], acc["username"])
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE servers SET password = ?, expiry = ?, status = 'ok', max_connections = ?, active_connections = ? WHERE id = ?",
                (acc["password"], acc["expiry"], acc.get("max_connections"), acc.get("active_cons"), row[0])
            )
            updated += 1
        else:
            cur.execute("""
                INSERT INTO servers (name, type, host, port, username, password, expiry, status, max_connections, active_connections)
                VALUES (?, 'xtream', ?, ?, ?, ?, ?, 'ok', ?, ?)
            """, (
                f"{acc['server_name']} ({acc['username']})",
                acc["host"],
                acc["port"],
                acc["username"],
                acc["password"],
                acc["expiry"],
                acc.get("max_connections"),
                acc.get("active_cons")
            ))
            inserted += 1

    conn.commit()
    conn.close()
    print(f"✦ Banco SQLite local atualizado: {inserted} novos inseridos, {updated} atualizados.")

if __name__ == "__main__":
    main()
