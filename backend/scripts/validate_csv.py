import csv
import json
import os
import socket
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

CSV_PATH = r"c:\Users\Fred\Downloads\ListasNormalizadas (1).csv"
OUTPUT_JSON = r"c:\Users\Fred\Projetos\XFinder\data\validated_accounts.json"

def check_dns(hostname):
    """Retorna True se o domínio resolver no DNS, False caso contrário."""
    try:
        socket.getaddrinfo(hostname, None)
        return True
    except Exception:
        return False

def validate_account(item):
    """Testa credenciais contra player_api.php."""
    srv = item["server"]
    user = item["username"]
    pwd = item["password"]

    api_url = f"{srv}/player_api.php?username={urllib.parse.quote(user)}&password={urllib.parse.quote(pwd)}"

    headers = {
        "User-Agent": "IPTVSmartersPro/1.0.0",
        "Accept": "*/*"
    }

    req = urllib.request.Request(api_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status != 200:
                return False, f"HTTP {resp.status}", None

            data_bytes = resp.read()
            try:
                data = json.loads(data_bytes.decode("utf-8", errors="replace"))
            except Exception:
                return False, "Resposta não é JSON válido", None

            uinfo = data.get("user_info", {})
            auth = uinfo.get("auth")
            status = str(uinfo.get("status", "")).lower()

            if auth != 1 and auth != "1":
                return False, f"Auth falhou (auth={auth})", None

            if status in ["expired", "disabled", "banned"]:
                return False, f"Conta {status}", None

            exp_ts = uinfo.get("exp_date")
            now_ts = int(time.time())
            exp_date_str = None

            if exp_ts and str(exp_ts).isdigit():
                val = int(exp_ts)
                if 0 < val < now_ts:
                    return False, f"Conta expirada no timestamp ({val})", None
                if val > 0:
                    exp_date_str = datetime.fromtimestamp(val).strftime("%Y-%m-%d")

            item["exp_date"] = exp_date_str
            item["max_connections"] = uinfo.get("max_connections")
            item["active_connections"] = uinfo.get("active_cons")
            item["server_name"] = f"{urllib.parse.urlparse(srv).hostname} ({user})"

            return True, "OK", item

    except Exception as e:
        return False, str(e)[:60], None

def main():
    print(f"[*] Lendo CSV: {CSV_PATH}")
    if not os.path.exists(CSV_PATH):
        print("Erro: Arquivo CSV não encontrado!")
        return

    with open(CSV_PATH, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"[*] Total de linhas no CSV: {len(rows)}")

    # 1. Deduplicação e parse
    unique_items = {}
    hostnames = set()

    for r in rows:
        srv = (r.get("servidor") or "").strip().rstrip("/")
        u = (r.get("username") or "").strip()
        p = (r.get("password") or "").strip()
        if not srv or not u or not p:
            continue

        parsed = urllib.parse.urlparse(srv)
        if not parsed.hostname:
            continue

        hostnames.add(parsed.hostname)
        key = (srv, u, p)
        if key not in unique_items:
            unique_items[key] = {
                "server": srv,
                "host": f"{parsed.scheme}://{parsed.hostname}",
                "port": str(parsed.port) if parsed.port else "",
                "hostname": parsed.hostname,
                "username": u,
                "password": p,
                "link_m3u": r.get("link_m3u") or r.get("\ufefflink_m3u") or ""
            }

    items = list(unique_items.values())
    print(f"[*] Contas únicas identificadas: {len(items)}")
    print(f"[*] Domínios/Hostnames distintos: {len(hostnames)}")

    # 2. Pré-filtro rápido de DNS em paralelo (50 workers)
    print("\n[Etapa 1/2] Testando resolução de DNS dos domínios...")
    alive_domains = set()
    dead_domains = set()

    with ThreadPoolExecutor(max_workers=50) as executor:
        future_to_host = {executor.submit(check_dns, h): h for h in hostnames}
        for future in as_completed(future_to_host):
            h = future_to_host[future]
            try:
                if future.result():
                    alive_domains.add(h)
                else:
                    dead_domains.add(h)
            except Exception:
                dead_domains.add(h)

    print(f" -> Domínios ativos no DNS: {len(alive_domains)}")
    print(f" -> Domínios mortos/desativados: {len(dead_domains)}")

    # Filtra contas apenas dos domínios que existem
    candidate_items = [it for it in items if it["hostname"] in alive_domains]
    print(f"[*] Contas com domínios resolvendo no DNS: {len(candidate_items)} (descartadas {len(items) - len(candidate_items)} de servidores offline)")

    # 3. Teste real de autenticação e status nas contas candidatas (40 workers)
    print("\n[Etapa 2/2] Testando autenticação Xtream Codes nas contas ativas...")
    valid_accounts = []
    failed_counts = {}
    completed = 0
    total_candidates = len(candidate_items)

    with ThreadPoolExecutor(max_workers=40) as executor:
        future_to_item = {executor.submit(validate_account, it): it for it in candidate_items}
        for future in as_completed(future_to_item):
            completed += 1
            it = future_to_item[future]
            try:
                is_valid, reason, enriched = future.result()
                if is_valid and enriched:
                    valid_accounts.append(enriched)
                    print(f"  [✓ VÁLIDA #{len(valid_accounts)}] {enriched['server']} | User: {enriched['username']} | Exp: {enriched.get('exp_date')}")
                else:
                    cat = reason.split(":")[0] if ":" in reason else reason
                    failed_counts[cat] = failed_counts.get(cat, 0) + 1
            except Exception as e:
                failed_counts["Erro interno"] = failed_counts.get("Erro interno", 0) + 1

            if completed % 100 == 0 or completed == total_candidates:
                print(f"  Progresso: {completed}/{total_candidates} testados (Válidas até agora: {len(valid_accounts)})")

    print("\n" + "="*50)
    print("           RESULTADO DA VALIDAÇÃO")
    print("="*50)
    print(f"Total analisado no CSV:   {len(rows)}")
    print(f"Contas únicas:             {len(items)}")
    print(f"Descartadas por DNS morto: {len(items) - len(candidate_items)}")
    print(f"Testadas ativamente:      {total_candidates}")
    print(f"TOTAL VÁLIDAS E ATIVAS:   {len(valid_accounts)}")
    print("\nMotivos de falha nos testes:")
    for reason, count in sorted(failed_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  - {reason}: {count}")

    # Salva resultado em JSON
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(valid_accounts, f, ensure_ascii=False, indent=2)

    print(f"\n[✓] Lista de contas válidas salva em: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()

