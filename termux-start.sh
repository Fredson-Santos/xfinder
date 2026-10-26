#!/data/data/com.termux/files/usr/bin/bash
if [ ! -f "./xfinder" ]; then
    echo "✦ Binário não encontrado. Compilando..."
    go build -ldflags="-s -w" -o xfinder ./cmd/server
    chmod +x xfinder
fi

echo "✦ Iniciando XFinder (Go Engine)..."
export PORT=3000
export HOST=0.0.0.0
./xfinder
