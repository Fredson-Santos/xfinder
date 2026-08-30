# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY css ./css
COPY js ./js
COPY index.html ./

RUN npm run build:ts

# ---------- Stage 2: runtime ----------
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/css ./css
COPY --from=builder /app/js ./js
COPY --from=builder /app/index.html ./index.html

RUN mkdir -p /app/data
ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
