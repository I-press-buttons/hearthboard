# syntax=docker/dockerfile:1

# ---- build: compile the web app and bundle the server ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- runtime ----
# Starts as root only to hand /data to PUID:PGID, then the server switches to that user.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HEARTHBOARD_DATA=/data \
    HEARTHBOARD_PHOTOS=/photos \
    HEARTHBOARD_WEB=/app/web/dist \
    PUID=1000 \
    PGID=1000 \
    TZ=UTC

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
