# ---------- Stage 0: build do painel web (Svelte + Vite) ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- Stage 1: build Go ----------
FROM golang:1.27-alpine AS builder

WORKDIR /app

# Dependências Go
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Código fonte
COPY backend/cmd ./cmd
COPY backend/internal ./internal

# Compilação com flags de otimização de tamanho
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/xfinder ./cmd/server

# ---------- Stage 2: runtime enxuto ----------
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app

# Copia binário e frontend web
COPY --from=builder /app/xfinder /app/xfinder
COPY --from=web /web/dist ./web

RUN mkdir -p /app/data
ENV PORT=2332 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIR=/app/web

EXPOSE 2332

CMD ["/app/xfinder"]
