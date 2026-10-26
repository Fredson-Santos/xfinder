#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=================================================="
echo "✦ Instalando dependências do XFinder (Go Engine)..."
echo "=================================================="

pkg update -y
pkg install -y golang python

echo "📦 Compilando XFinder em binário nativo para Android (ARM64)..."
go build -ldflags="-s -w" -o xfinder ./cmd/server
chmod +x xfinder

echo "📦 Instalando dependências do Bot do Telegram (opcional)..."
pip install --upgrade pip
pip install telethon requests

echo ""
echo "=================================================="
echo "✓ Instalação e compilação concluídas com sucesso!"
echo "=================================================="
echo "• Para iniciar o XFinder:          ./termux-start.sh"
echo "• Para iniciar o Bot do Telegram:  ./termux-bot.sh"
echo "• Para iniciar tudo junto:         ./termux-all.sh"
echo "=================================================="
