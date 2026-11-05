#!/usr/bin/env python3
"""
XFinder — Telegram List Automation Bot
Monitora canais do Telegram, lê mensagens e arquivos anexos (.txt, .m3u),
extrai credenciais/listas IPTV/Xtream/M3U, envia para a API do XFinder,
sincroniza imediatamente o conteúdo e remove listas expiradas automaticamente.
"""

import os
import sys
import re
import json
import time
import asyncio
import unicodedata
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from typing import List, Dict, Any, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

try:
    import requests
except ImportError:
    print("Erro: O pacote 'requests' não está instalado. Instale com: pip install requests")
    sys.exit(1)

try:
    from telethon import TelegramClient, events
    from telethon.tl.types import DocumentAttributeFilename
except ImportError:
    print("Erro: O pacote 'telethon' não está instalado. Instale com: pip install telethon")
    sys.exit(1)

# ─── Configurações e Variáveis de Ambiente ─────────────────────────────────────

def load_env_file():
    """Carrega variáveis do arquivo .env buscando na raiz ou diretório atual."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), ".env")),
    ]
    for filepath in candidates:
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v
            break

load_env_file()

DEFAULT_API_ID = 21993165
DEFAULT_API_HASH = "2017110c1ffe36db9adc12f808cc09bc"

API_ID = int(os.environ.get("TELEGRAM_API_ID", DEFAULT_API_ID))
API_HASH = os.environ.get("TELEGRAM_API_HASH", DEFAULT_API_HASH)
CHANNEL = os.environ.get("TELEGRAM_CHANNEL", "")
XFINDER_API_URL = os.environ.get("XFINDER_API_URL", "http://localhost:2332/api").rstrip("/")
AUTO_SYNC = os.environ.get("AUTO_SYNC", "true").lower() in ("true", "1", "yes")
DELETE_ON_ERROR = os.environ.get("DELETE_ON_ERROR", "true").lower() in ("true", "1", "yes")
SESSION_NAME = os.environ.get(
    "TELEGRAM_SESSION",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "telegram_user"))
)

# ─── Normalização e Parser de Listas ──────────────────────────────────────────

SMALL_CAPS_MAP = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
    'ᴩ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w',
    'x': 'x', 'ʏ': 'y', 'ᴢ': 'z',
    '\u1d18': 'p', '\u1d1b': 't', '\u026a': 'i', '\u0274': 'n', '\u1d0f': 'o',
    '\u1d07': 'e', '\u1d00': 'a', '\u0280': 'r', '\u1d1c': 'u', '\ua731': 's',
}

def normalize_text(text: str) -> str:
    """Converte caracteres small caps e normaliza unicode para texto ASCII padrão."""
    chars = [SMALL_CAPS_MAP.get(c, c) for c in text]
    return unicodedata.normalize('NFKD', ''.join(chars))

def parse_expiry_date(date_str: str) -> Optional[datetime]:
    """Interpreta datas nos formatos comuns (DD/MM/YYYY, YYYY-MM-DD, unix timestamp)."""
    if not date_str:
        return None
    s = date_str.strip()
    # Unix timestamp
    if re.match(r'^\d{10,13}$', s):
        try:
            ts = int(s)
            return datetime.fromtimestamp(ts if ts < 1e11 else ts / 1000)
        except Exception:
            pass
    # DD/MM/YYYY
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m:
        d, mo, y = m.groups()
        try:
            return datetime(int(y), int(mo), int(d), 23, 59, 59)
        except Exception:
            pass
    # YYYY-MM-DD
    m = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', s)
    if m:
        y, mo, d = m.groups()
        try:
            return datetime(int(y), int(mo), int(d), 23, 59, 59)
        except Exception:
            pass
    return None

def is_expired(date_str: str) -> bool:
    """Verifica se uma data de expiração já passou."""
    dt = parse_expiry_date(date_str)
    if dt:
        return dt < datetime.now()
    return False

def format_iso_date(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%Y-%m-%d") if dt else None

def parse_lists(raw_text: str) -> List[Dict[str, Any]]:
    """
    Analisa um bloco de texto ou arquivo e extrai todas as listas IPTV/Xtream.
    Suporta:
      1. Cards formatados (Hit Hunter, Ishiro, SrFrio, etc.) com small caps
      2. URLs diretas Xtream (get.php, player_api.php, /live/user/pass)
      3. Linhas delimitadas (host user pass)
      4. Links diretos M3U
    """
    if not raw_text or not raw_text.strip():
        return []

    results = []
    seen = set()

    # 1. Procura blocos estruturados (Hit Hunter, etc.)
    # Divide por quebra de card (ex: ╭─── ou similares)
    blocks = re.split(r'╭[─━]+', raw_text)
    for block in blocks:
        norm = normalize_text(block)
        user_m = re.search(r'(?:user|usuario)\s*:\s*([^\r\n]+)', norm, re.IGNORECASE)
        pass_m = re.search(r'(?:pass|senha)\s*:\s*([^\r\n]+)', norm, re.IGNORECASE)
        server_m = re.search(r'(?:server|servidor|host)\s*:\s*(https?://[^\s\r\n]+)', norm, re.IGNORECASE)
        exp_m = re.search(r'(?:expiration|expiracao|validade|exp)\s*:\s*([^\r\n]+)', norm, re.IGNORECASE)
        m3u_m = re.search(r'(?:m3u|playlist|url)\s*:\s*(https?://[^\s\r\n]+)', norm, re.IGNORECASE)

        user = user_m.group(1).strip() if user_m else None
        password = pass_m.group(1).strip() if pass_m else None
        server = server_m.group(1).strip() if server_m else None
        expiry_raw = exp_m.group(1).strip() if exp_m else None
        m3u_url = m3u_m.group(1).strip() if m3u_m else None

        if not server and m3u_url:
            parsed = urlparse(m3u_url)
            server = f"{parsed.scheme}://{parsed.netloc}"
            if not user or not password:
                qs = parse_qs(parsed.query)
                user = (qs.get('username') or qs.get('user') or [user])[0]
                password = (qs.get('password') or qs.get('pass') or [password])[0]

        if server and user and password:
            clean_host = server.rstrip('/')
            parsed_host = urlparse(clean_host)
            host_only = f"{parsed_host.scheme}://{parsed_host.netloc}"
            port = str(parsed_host.port) if parsed_host.port else None
            key = f"{host_only.lower()}|{user.lower()}|{password}"
            if key not in seen:
                seen.add(key)
                exp_dt = parse_expiry_date(expiry_raw)
                exp_iso = format_iso_date(exp_dt) or expiry_raw
                expired = exp_dt < datetime.now() if exp_dt else False
                domain = parsed_host.hostname or 'Xtream'
                results.append({
                    'name': f"{domain} ({user})",
                    'serverType': 'xtream',
                    'host': host_only,
                    'port': port,
                    'username': user,
                    'password': password,
                    'm3uUrl': m3u_url,
                    'expiry': exp_iso,
                    'expired': expired
                })

    # 2. URLs Xtream (get.php ou player_api.php) soltas no texto
    for line in raw_text.splitlines():
        line = line.strip()
        url_match = re.search(r'(https?://[^\s,;"\'|]+(?:get\.php|player_api\.php)[^\s,;"\'|]*)', line, re.IGNORECASE)
        if url_match:
            u = url_match.group(1)
            parsed = urlparse(u)
            qs = parse_qs(parsed.query)
            user = (qs.get('username') or qs.get('user') or [None])[0]
            password = (qs.get('password') or qs.get('pass') or [None])[0]
            if user and password:
                host_only = f"{parsed.scheme}://{parsed.netloc}"
                port = str(parsed.port) if parsed.port else None
                key = f"{host_only.lower()}|{user.lower()}|{password}"
                if key not in seen:
                    seen.add(key)
                    domain = parsed.hostname or 'Xtream'
                    results.append({
                        'name': f"{domain} ({user})",
                        'serverType': 'xtream',
                        'host': host_only,
                        'port': port,
                        'username': user,
                        'password': password,
                        'm3uUrl': u,
                        'expiry': None,
                        'expired': False
                    })
            continue

        # 3. Formato direto: http://host:port/live/user/pass/id.ts
        live_match = re.search(r'^(https?://[^\/]+)/(?:live|movie|series)/([^/]+)/([^/]+)/', line, re.IGNORECASE)
        if live_match:
            host_url, user, password = live_match.groups()
            parsed = urlparse(host_url)
            port = str(parsed.port) if parsed.port else None
            key = f"{host_url.lower()}|{user.lower()}|{password}"
            if key not in seen:
                seen.add(key)
                domain = parsed.hostname or 'Xtream'
                results.append({
                    'name': f"{domain} ({user})",
                    'serverType': 'xtream',
                    'host': host_url,
                    'port': port,
                    'username': user,
                    'password': password,
                    'm3uUrl': None,
                    'expiry': None,
                    'expired': False
                })

    return results

# ─── Cliente da API do XFinder ────────────────────────────────────────────────

class XFinderClient:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def get_servers(self) -> List[Dict[str, Any]]:
        try:
            r = requests.get(f"{self.base_url}/servers", timeout=10)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"  [XFinder API] Erro ao consultar servidores: {e}")
        return []

    def server_exists(self, existing: List[Dict[str, Any]], candidate: Dict[str, Any]) -> bool:
        c_host = (candidate.get('host') or '').lower().rstrip('/')
        c_user = (candidate.get('username') or '').lower()
        c_pass = candidate.get('password') or ''
        c_m3u = (candidate.get('m3uUrl') or '').lower()

        for s in existing:
            s_host = (s.get('host') or '').lower().rstrip('/')
            s_user = (s.get('username') or '').lower()
            s_pass = s.get('password') or ''
            s_m3u = (s.get('m3u_url') or '').lower()

            if candidate['serverType'] == 'xtream':
                if s_host and s_user and s_host == c_host and s_user == c_user and s_pass == c_pass:
                    return True
            if c_m3u and s_m3u and c_m3u == s_m3u:
                return True
        return False

    def add_server(self, data: Dict[str, Any]) -> Optional[int]:
        try:
            payload = {
                "name": data["name"],
                "serverType": data["serverType"],
                "host": data.get("host"),
                "port": data.get("port"),
                "username": data.get("username"),
                "password": data.get("password"),
                "m3uUrl": data.get("m3uUrl"),
                "expiry": data.get("expiry"),
            }
            r = requests.post(f"{self.base_url}/servers", json=payload, timeout=10)
            if r.status_code in (200, 201):
                res = r.json()
                return res.get("id")
            else:
                print(f"  [XFinder API] Erro ao adicionar servidor: HTTP {r.status_code} - {r.text}")
        except Exception as e:
            print(f"  [XFinder API] Falha na requisição de adicionar servidor: {e}")
        return None

    def sync_server(self, server_id: int, delete_on_error: bool = True) -> bool:
        try:
            url = f"{self.base_url}/servers/{server_id}/sync"
            params = {"deleteOnError": "true"} if delete_on_error else {}
            r = requests.post(url, params=params, timeout=150)
            if r.status_code == 200:
                data = r.json()
                print(f"  ✓ [Sync #{server_id}] Sucesso: {data.get('message', 'OK')}")
                return True
            else:
                err_msg = r.text
                try:
                    err_msg = r.json().get('error', err_msg)
                except Exception:
                    pass
                print(f"  ✕ [Sync #{server_id}] Falha ({err_msg}). Servidor descartado.")
                return False
        except Exception as e:
            print(f"  ✕ [Sync #{server_id}] Timeout/Erro ao sincronizar ({e}).")
            if delete_on_error:
                try:
                    requests.delete(f"{self.base_url}/servers/{server_id}", timeout=5)
                except Exception:
                    pass
            return False

    def cleanup_expired(self) -> int:
        try:
            r = requests.post(f"{self.base_url}/servers/cleanup-expired", timeout=10)
            if r.status_code == 200:
                removed = r.json().get('removed', 0)
                if removed > 0:
                    print(f"  [AutoExpire] {removed} servidor(es) expirado(s) removido(s) do banco.")
                return removed
        except Exception:
            pass
        return 0

# ─── Processamento de Mensagens e Listas ───────────────────────────────────────

async def process_content(text: str, source_label: str, xfinder: XFinderClient):
    lists = parse_lists(text)
    if not lists:
        return

    print(f"\n[Telegram Bot] 📥 Encontradas {len(lists)} listas em '{source_label}':")

    # Atualiza lista atual do banco para evitar duplicatas
    existing = xfinder.get_servers()

    for item in lists:
        name = item['name']
        host = item['host']
        user = item['username']
        exp = item.get('expiry')

        # 1. Verifica se já expirou antes mesmo de salvar
        if item.get('expired'):
            print(f"  ⚠️ Ignorado: Servidor {name} já está expirado (Validade: {exp}).")
            continue

        # 2. Verifica duplicação no banco de dados
        if xfinder.server_exists(existing, item):
            print(f"  ℹ️ Já cadastrado: Servidor {name} ({host}) já existe no XFinder. Pulando.")
            continue

        # 3. Adiciona ao banco de dados
        print(f"  ➕ Cadastrando: {name} (Validade: {exp or 'Desconhecida'})...")
        server_id = xfinder.add_server(item)
        if not server_id:
            continue

        # 4. Sincroniza imediatamente se habilitado
        if AUTO_SYNC:
            print(f"  🔄 Sincronizando #{server_id} ({name}) imediatamente...")
            # Executa sinc em thread para não travar o loop de eventos assíncrono
            success = await asyncio.to_thread(xfinder.sync_server, server_id, DELETE_ON_ERROR)
            if success:
                print(f"  🎉 Servidor #{server_id} pronto e ativo no XFinder!")
            else:
                print(f"  🗑️ Servidor #{server_id} indisponível/expirado foi removido.")
        else:
            print(f"  ✓ Servidor #{server_id} salvo com sucesso no banco de dados.")

        # Adiciona à lista local para evitar duplicatas repetidas no mesmo lote
        existing.append({
            'host': item.get('host'),
            'username': item.get('username'),
            'password': item.get('password'),
            'm3u_url': item.get('m3uUrl')
        })

# ─── Tarefa em Segundo Plano de Limpeza de Expirados ──────────────────────────

async def periodic_cleanup_task(xfinder: XFinderClient):
    while True:
        try:
            await asyncio.sleep(15 * 60) # A cada 15 minutos
            await asyncio.to_thread(xfinder.cleanup_expired)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[AutoExpire Error]: {e}")

# ─── Resolução do Canal Telegram ─────────────────────────────────────────────

def parse_channel_target(raw: Any) -> Any:
    """Extrai ID numérico ou @username a partir de URLs do Telegram Web, IDs ou links."""
    s = str(raw).strip()
    # Ex: https://web.telegram.org/a/#-1003392154674_1334 ou #-1003392154674
    m = re.search(r'#?(-100\d+|\d+)', s)
    if m and ('web.telegram.org' in s or s.startswith('-100')):
        try:
            return int(m.group(1))
        except ValueError:
            pass
    if s.startswith('-') and s[1:].isdigit():
        return int(s)
    if s.isdigit():
        return int(s)
    return s

async def get_channel_entity_robust(client: TelegramClient, target: Any):
    parsed = parse_channel_target(target)
    try:
        return await client.get_entity(parsed)
    except Exception:
        # Em canais privados/numéricos, iterar os diálogos popula o cache interno do Telethon
        try:
            async for dialog in client.iter_dialogs(limit=100):
                if dialog.id == parsed or str(dialog.id) == str(target):
                    return dialog.entity
                if isinstance(parsed, int):
                    dialog_channel_id = getattr(dialog.entity, 'id', None)
                    if dialog_channel_id and (dialog_channel_id == abs(parsed) or f"-100{dialog_channel_id}" == str(parsed)):
                        return dialog.entity
        except Exception:
            pass
        return await client.get_entity(parsed)

# ─── Execução do Cliente Telegram ─────────────────────────────────────────────

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="XFinder Telegram Bot Automation")
    parser.add_argument("--test-file", help="Executa o parser em um arquivo local e envia para o XFinder sem conectar no Telegram")
    parser.add_argument("--channel", default=CHANNEL, help="Nome do canal, ID ou link do Telegram")
    parser.add_argument("--scan-history", type=int, default=10, help="Quantidade de mensagens recentes do canal a processar no início")
    parser.add_argument("--no-sync", action="store_true", help="Desabilita sincronização imediata")
    args = parser.parse_args()

    global AUTO_SYNC
    if args.no_sync:
        AUTO_SYNC = False

    xfinder = XFinderClient(XFINDER_API_URL)

    # Modo teste em arquivo local
    if args.test_file:
        if not os.path.exists(args.test_file):
            print(f"Erro: Arquivo '{args.test_file}' não encontrado.")
            sys.exit(1)
        print(f"[XFinder Bot] Modo Teste Local — Lendo '{args.test_file}'...")
        with open(args.test_file, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        await process_content(content, f"Arquivo local {args.test_file}", xfinder)
        return

    # Modo Telegram MTProto
    channel_target = args.channel or CHANNEL
    if not channel_target:
        print("\n==================================================================")
        print("✦ XFinder — Configuração do Canal do Telegram")
        print("==================================================================")
        print("Informe o canal que deseja monitorar.")
        print("Pode ser o @nomedocanal (ex: @listas_iptv), link ou ID do canal:")
        channel_target = input("Canal: ").strip()
        if not channel_target:
            print("Erro: Nenhum canal informado.")
            sys.exit(1)

    os.makedirs(os.path.dirname(SESSION_NAME), exist_ok=True)

    print("\n==================================================================")
    print("✦ XFinder — Telegram Automation Bot")
    print("==================================================================")
    print(f"  • API ID:         {API_ID}")
    print(f"  • Canal Alvo:     {channel_target}")
    print(f"  • API XFinder:    {XFINDER_API_URL}")
    print(f"  • Auto Sync:      {'Ativo' if AUTO_SYNC else 'Desativado'}")
    print(f"  • Auto Expire:    Ativo (a cada 15 min)")
    print(f"  • Sessão Salva:   {SESSION_NAME}.session")
    print("==================================================================\n")

    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)

    print("[Telegram] Conectando ao Telegram...")
    # client.start() solicitará telefone e código na 1ª vez via console interativo
    await client.start()
    me = await client.get_me()
    print(f"[Telegram] ✓ Conectado com sucesso como: {me.first_name} (@{me.username or me.phone})")

    try:
        channel_entity = await get_channel_entity_robust(client, channel_target)
        channel_title = getattr(channel_entity, 'title', str(channel_target))
        print(f"[Telegram] ✓ Canal localizado: '{channel_title}'")
    except Exception as e:
        print(f"[Telegram] ✕ Erro ao localizar o canal '{channel_target}': {e}")
        print("Certifique-se de que sua conta entrou no canal ou que o ID está correto.")
        await client.disconnect()
        sys.exit(1)

    # Inicia a tarefa de limpeza periódica de expirados
    asyncio.create_task(periodic_cleanup_task(xfinder))

    # Handler para novas mensagens em tempo real no canal
    @client.on(events.NewMessage(chats=channel_entity))
    async def handle_new_message(event):
        msg = event.message
        print(f"\n[Telegram] 🔔 Nova mensagem recebida no canal (ID: {msg.id})")

        # 1. Se tem texto na mensagem
        if msg.text:
            await process_content(msg.text, f"Mensagem #{msg.id}", xfinder)

        # 2. Se tem arquivo anexo (.txt, .m3u, etc.)
        if msg.document:
            filename = None
            for attr in msg.document.attributes:
                if isinstance(attr, DocumentAttributeFilename):
                    filename = attr.file_name
                    break
            
            # Se for documento de texto ou nome terminar com .txt / .m3u
            is_text_doc = msg.file and (
                msg.file.mime_type and 'text' in msg.file.mime_type or
                filename and filename.lower().endswith(('.txt', '.m3u', '.m3u8'))
            )
            
            if is_text_doc or filename:
                fname = filename or f"doc_{msg.id}.txt"
                print(f"[Telegram] 📎 Baixando arquivo anexo: '{fname}'...")
                file_bytes = await client.download_media(msg, bytes)
                if file_bytes:
                    try:
                        content = file_bytes.decode('utf-8')
                    except UnicodeDecodeError:
                        content = file_bytes.decode('latin-1', errors='ignore')
                    await process_content(content, f"Arquivo '{fname}' (Msg #{msg.id})", xfinder)

    # Varredura das mensagens recentes do canal na inicialização
    if args.scan_history > 0:
        print(f"[Telegram] 🔍 Verificando as últimas {args.scan_history} mensagens do canal...")
        count = 0
        async for msg in client.iter_messages(channel_entity, limit=args.scan_history):
            if msg.document:
                filename = None
                for attr in msg.document.attributes:
                    if isinstance(attr, DocumentAttributeFilename):
                        filename = attr.file_name
                        break
                if filename and filename.lower().endswith(('.txt', '.m3u', '.m3u8')):
                    print(f"  📎 Arquivo encontrado no histórico: '{filename}'")
                    file_bytes = await client.download_media(msg, bytes)
                    if file_bytes:
                        try:
                            content = file_bytes.decode('utf-8')
                        except UnicodeDecodeError:
                            content = file_bytes.decode('latin-1', errors='ignore')
                        await process_content(content, f"Histórico: {filename}", xfinder)
                        count += 1
            elif msg.text:
                if 'get.php' in msg.text or 'player_api.php' in msg.text or 'нιт' in msg.text:
                    await process_content(msg.text, f"Histórico: Msg #{msg.id}", xfinder)
                    count += 1
        print(f"[Telegram] ✓ Varredura inicial concluída ({count} mensagens processadas).")

    print(f"\n[Telegram] 🟢 Bot rodando em tempo real e monitorando '{channel_title}'...")
    print("Pressione Ctrl+C para encerrar.\n")
    await client.run_until_disconnected()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Telegram Bot] Encerrado pelo usuário.")
