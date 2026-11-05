# XFinder 🚀

**Agregador Multi-Servidor IPTV, Proxy Xtream Codes & Painel Web com Player Integrado e Failover Automático.**

Escrito em **Go puro** (Zero dependências externas, CGO-free, binário único auto-contido) com suporte completo a clientes como **IPTV Smarters Pro**, **TiviMate**, **XCIPTV**, navegadores web e TVs.

---

## 📁 Estrutura do Projeto

```text
XFinder/
├── backend/
│   ├── cmd/server/          # Entrypoint do servidor Go (main.go)
│   ├── internal/            # Núcleo: api, db, m3u, models, proxy, xtream
│   ├── scripts/             # Scripts de manutenção (*.py) + telegram_bot.py
│   ├── go.mod / go.sum      # Dependências Go
│   └── Dockerfile           # Imagem multi-stage Go ultra-enxuta (~25MB)
├── android-tv/              # App nativo Android TV (Kotlin, Jetpack Compose, Gradle)
│   └── app/                 # Código-fonte do app para Smart TV
├── web/                     # Painel Web (Svelte 5 + Vite) — build em web/dist
│   ├── src/lib/             # Lógica: API, rotas, progresso, servidores, streams
│   ├── src/components/      # Player (ArtPlayer + hls.js), tabela de servidores, etc.
│   └── src/pages/           # Início, Série, Filme/Canal, Configurações
├── data/                    # SQLite runtime (xfinder.db, volume Docker, gitignored)
├── docker-compose.yml       # Orquestração Docker na raiz apontando para backend/Dockerfile
├── .env / .env.example      # Variáveis de ambiente
├── .gitignore               # Regras de ignore limpas e abrangentes
└── README.md                # Documentação do projeto
```

---

## ⚡ Principais Funcionalidades

- **Proxy Xtream Codes Emulado (`/player_api.php`)**: Conecte o IPTV Smarters Pro, TiviMate ou XCIPTV apontando para o XFinder como se fosse um único servidor unificado.
- **Player Web Integrado (ArtPlayer + HLS.js)**: Assista diretamente no navegador com reprodução de streams IPTV (`.m3u8`, `.ts`, `.mp4`), salvamento exato de episódios, retomada de tempo e layout de cinema.
- **Stream Relay Real & Anti-Timeout**: Repassa o fluxo de vídeo diretamente (chunk buffer de 64KB) com suporte a `Range` requests (avanço rápido/seek) e headers anti-bloqueio (`IPTVSmartersPro/1.0.0`).
- **Failover Instantâneo de Vídeo**: Se o servidor IPTV de um canal ou filme cair ou der timeout, o proxy tenta automaticamente fontes alternativas com o mesmo título cadastradas no banco antes de falhar.
- **Busca Global Instantânea**: Pesquisa unificada por títulos entre centenas de servidores e listas M3U.
- **Séries como num streaming**: continuar de onde parou, episódios vistos, "marcar como visto", próximo episódio automático e botão "Pular abertura" (+1:30, configurável). Na TV, use o app `android-tv/`.
- **Gerência de servidores em lote**: selecione vários servidores para sincronizar ou remover de uma vez, com filtros por status e vencimento.
- **Deduplicação Inteligente**: Normalização de categorias e títulos repetidos.
- **Limpeza Automática de Expirados (AutoExpire)**: Monitora e expurga servidores vencidos no boot e a cada 15 minutos.

---

## 🛠️ Como Executar

### 1. Painel Web (build)

O painel é compilado uma vez e servido pelo Go a partir de `web/dist`:

```bash
cd web
npm install
npm run build        # gera web/dist
```

Para desenvolver com recarga automática (com o servidor Go rodando na porta 3000):

```bash
cd web
npm run dev          # http://localhost:5173 (a API é redirecionada para :3000)
```

### 2. Servidor Go (Nativo)

#### A partir da raiz:

```bash
# Compilar binário:
go build -C backend -ldflags="-s -w" -o ../xfinder.exe ./cmd/server

# Executar:
.\xfinder.exe
```

#### A partir da pasta `backend/`:

```bash
cd backend
go run ./cmd/server
```

O servidor estará acessível em:

- **Painel Web**: [http://localhost:3000](http://localhost:3000)
- **Xtream Codes (Smarters/TiviMate)**: `http://SEU_IP:3000` (Usuário: `xfinder` | Senha: `xfinder`)
- **Playlist M3U**: `http://SEU_IP:3000/playlist.m3u`

---

### 3. Docker & Docker Compose

Execute na raiz do projeto:

```bash
docker compose up -d --build
```

---

### 4. Bot do Telegram (Automação Opcional)

Monitora canais públicos ou privados do Telegram e cadastra listas e contas Xtream automaticamente no XFinder:

```bash
# Configurar credenciais no .env
cp .env.example .env

# Executar o bot:
python backend/scripts/telegram_bot.py
```

---

### 5. App Android TV

O projeto em `android-tv/` é um aplicativo nativo para Android TV construído com Kotlin e Jetpack Compose.
Para abrir e compilar:

1. Abra a pasta `android-tv` no **Android Studio**.
2. Compile e instale no dispositivo Android TV via ADB ou gere o APK assinado.

---

## ⚙️ Variáveis de Ambiente (`.env`)

| Variável             | Padrão                       | Descrição                                              |
| :-------------------- | :---------------------------- | :------------------------------------------------------- |
| `PORT`              | `3000`                      | Porta HTTP do servidor Go                                |
| `HOST`              | `0.0.0.0`                   | Interface de rede (0.0.0.0 para acesso local e Wi-Fi)    |
| `DATA_DIR`          | `./data`                    | Diretório onde o banco SQLite (`xfinder.db`) é salvo |
| `WEB_DIR`           | `./web/dist`                | Build do Painel Web (cai para `./web` se não existir)  |
| `TELEGRAM_API_ID`   | -                             | API ID da aplicação Telegram (my.telegram.org)         |
| `TELEGRAM_API_HASH` | -                             | API Hash da aplicação Telegram                         |
| `TELEGRAM_CHANNEL`  | -                             | Canal monitorado (@canal ou link)                        |
| `XFINDER_API_URL`   | `http://localhost:3000/api` | Endpoint da API do XFinder para importações            |

---

## 📺 Configuração no IPTV Smarters Pro / TiviMate

- **Nome da Conexão**: `XFinder`
- **Nome de Usuário**: `xfinder`
- **Senha**: `xfinder`
- **URL do Servidor**: `http://IP_DO_SERVIDOR:3000` *(ex: `http://192.168.15.158:3000`)*
