import json
import os
import sys
import time
import urllib.request
import urllib.error

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

API_BASE = "http://localhost:3000/api"
VALIDATED_JSON = r"c:\Users\Fred\Projetos\XFinder\data\validated_accounts.json"

def post_json(endpoint, data):
    url = f"{API_BASE}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def sync_server(server_id):
    url = f"{API_BASE}/servers/{server_id}/sync?deleteOnError=true"
    req = urllib.request.Request(url, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return True, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}: {body}"
    except Exception as e:
        return False, str(e)

def main():
    if not os.path.exists(VALIDATED_JSON):
        print(f"Arquivo {VALIDATED_JSON} não encontrado!")
        return

    with open(VALIDATED_JSON, "r", encoding="utf-8") as f:
        accounts = json.load(f)

    print(f"[*] Carregadas {len(accounts)} contas validadas do arquivo JSON.")

    # 1. Monta payload para criação em lote
    batch_payload = {"servers": []}
    for acc in accounts:
        srv_name = acc.get("server_name") or f"{acc['hostname']} ({acc['username']})"
        batch_payload["servers"].append({
            "name": srv_name,
            "serverType": "xtream",
            "host": acc["host"],
            "port": acc["port"] if acc.get("port") else None,
            "username": acc["username"],
            "password": acc["password"],
            "expiry": acc.get("exp_date")
        })

    print(f"[*] Enviando {len(batch_payload['servers'])} servidores para a API do XFinder...")
    try:
        res = post_json("/servers/batch", batch_payload)
        created = res.get("servers", [])
        print(f"[✓] {len(created)} servidores cadastrados com sucesso na base de dados!")
    except Exception as e:
        print(f"[X] Falha ao cadastrar servidores em lote: {e}")
        return

    # 2. Sincroniza cada um e contabiliza catálogo
    print("\n[*] Iniciando sincronização dos catálogos (Live, VOD e Séries)...")
    success = 0
    total_items = 0

    for idx, srv in enumerate(created):
        sid = srv["id"]
        sname = srv["name"]
        print(f"  [{idx+1}/{len(created)}] Sincronizando ID {sid}: {sname}...")
        t0 = time.time()
        ok, res = sync_server(sid)
        elapsed = time.time() - t0

        if ok:
            msg = res.get("message", "")
            print(f"      ✓ Concluído ({elapsed:.1f}s): {msg}")
            success += 1
        else:
            print(f"      ✕ Falha/Descartado ({elapsed:.1f}s): {res}")

    print("\n" + "="*50)
    print("      RESUMO DA SINCRONIZAÇÃO LOCAL")
    print("="*50)
    print(f"Total de servidores validados testados: {len(created)}")
    print(f"Servidores sincronizados com sucesso:   {success}")
    print(f"Servidores descartados por erro:         {len(created) - success}")

if __name__ == "__main__":
    main()
