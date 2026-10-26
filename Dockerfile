# ---------- Stage 1: build Go ----------
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Dependências Go
COPY go.mod go.sum ./
RUN go mod download

# Código fonte
COPY cmd ./cmd
COPY internal ./internal

# Compilação com flags de otimização de tamanho
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/xfinder ./cmd/server

# ---------- Stage 2: runtime enxuto ----------
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app

# Copia binário e frontend web
COPY --from=builder /app/xfinder /app/xfinder
COPY css ./css
COPY js ./js
COPY index.html ./index.html

RUN mkdir -p /app/data
ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

EXPOSE 3000

CMD ["/app/xfinder"]
