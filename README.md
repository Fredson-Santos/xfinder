# XFinder 🚀

**Agregador Multi-Servidor IPTV, Proxy Xtream Codes & Painel Web com Failover Automático.**

Escrito em **Go puro** (Zero dependências externas, CGO-free, binário único auto-contido) com suporte completo a clientes como **IPTV Smarters Pro**, **TiviMate**, **XCIPTV**, navegadores web e TVs.

---

## ⚡ Principais Funcionalidades

- **Proxy Xtream Codes Emulado (`/player_api.php`)**: Conecte o IPTV Smarters Pro ou TiviMate apontando para o XFinder como se fosse um único servidor unificado.
- **Stream Relay Real & Anti-Timeout**: Repassa o fluxo de vídeo diretamente (chunk buffer de 64KB) com suporte a `Range` requests (avanço rápido/seek) e headers anti-bloqueio (`IPTVSmartersPro/1.0.0`).
- **Failover Instantâneo de Vídeo**: Se o servidor IPTV de um canal ou filme cair ou der timeout, o proxy tenta automaticamente fontes alternativas com o mesmo título cadastradas no banco antes de falhar.
- **Busca Global Instantânea**: Pesquisa unificada por títulos entre centenas de servidores e listas M3U.
- **Painel Web Moderno & Modo D-Pad (Smart TV)**: Interface web responsiva com navegação por controle remoto (teclas direcionais) para TVs e TV Boxes.
- **Deduplicação Inteligente**: Normalização de categorias e títulos repetidos.
- **Limpeza Automática de Expirados (AutoExpire)**: Monitora e expurga servidores vencidos no boot e a cada 15 minutos.

---

## 🛠️ Como Executar

### 1. Windows / Linux / macOS (Nativo)

#### Compilar:
```bash
go build -ldflags="-s -w" -o xfinder ./cmd/server
```

#### Rodar:
```bash
./xfinder
# ou no Windows:
.\xfinder.exe
```

O servidor estará acessível em:
- **Painel Web**: [http://localhost:3000](http://localhost:3000)
- **Xtream Codes (Smarters/TiviMate)**: `http://SEU_IP:3000` (Usuário: `xfinder` | Senha: `xfinder`)
- **Playlist M3U**: `http://SEU_IP:3000/playlist.m3u`

---

### 2. Docker & Docker Compose

```bash
docker compose up -d --build
```

---

### 3. Android (via Termux)

1. Clone o repositório no Termux:
```bash
git clone https://github.com/Fredson-Santos/xfinder.git
cd xfinder
```

2. Execute o setup inicial:
```bash
chmod +x termux-*.sh
./termux-setup.sh
```

3. Inicie o servidor:
```bash
./termux-start.sh
```

---

## ⚙️ Variáveis de Ambiente

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta HTTP do servidor |
| `HOST` | `0.0.0.0` | Interface de rede (0.0.0.0 para acesso na rede local / Wi-Fi) |
| `DATA_DIR` | `./data` | Diretório onde o banco SQLite (`xfinder.db`) é salvo |

---

## 📺 Configuração no IPTV Smarters Pro / TiviMate

- **Qualquer nome de exibição**: `XFinder`
- **Nome de usuário**: `xfinder`
- **Senha**: `xfinder`
- **URL do Servidor**: `http://IP_DA_MAQUINA:3000` *(ex: `http://192.168.1.100:3000`)*

---

## 📁 Estrutura do Projeto

```
├── cmd/
│   └── server/          # Ponto de entrada (main.go)
├── internal/
│   ├── api/             # Endpoints REST para o Painel Web
│   ├── db/              # Banco SQLite com modernc.org/sqlite (CGO-free)
│   ├── m3u/             # Parser de playlists M3U
│   ├── models/          # Structs de dados
│   ├── proxy/           # Xtream Codes Player API e Stream Relay com Failover
│   └── xtream/          # Cliente HTTP Xtream com sincronização concorrente
├── css/                 # Estilos do painel web
├── js/                  # Lógica do painel web e suporte a controle D-Pad
├── index.html           # SPA do painel web
├── data/                # Banco de dados local (xfinder.db)
├── telegram_bot.py      # Automação opcional para monitorar canais do Telegram
└── Dockerfile           # Imagem multi-stage Go ultra-leve (~25MB)
```
