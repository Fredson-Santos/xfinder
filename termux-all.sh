#!/data/data/com.termux/files/usr/bin/bash
trap "kill 0" EXIT

if [ ! -f "./xfinder" ]; then
    echo "✦ Binário não encontrado. Compilando..."
    go build -ldflags="-s -w" -o xfinder ./cmd/server
    chmod +x xfinder
fi

echo "✦ Iniciando Servidor XFinder..."
./xfinder &
sleep 2

echo "✦ Iniciando Bot do Telegram..."
python telegram_bot.py &

wait
