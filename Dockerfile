# NAKLearn-Server mit Web-Client, pdftoppm und claude-CLI (siehe docs/superpowers/specs/2026-10-13-naklearn-torte-design.md)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/store/package.json packages/store/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.296
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/client/package.json ./apps/client/package.json
COPY --from=build /app/apps/client/dist ./apps/client/dist
ENV NODE_ENV=production \
    NAKLEARN_DATA_DIR=/data \
    NAKLEARN_PORT=8742 \
    NAKLEARN_HOST=0.0.0.0 \
    NAKLEARN_CLAUDE=claude \
    NAKLEARN_WEB_DIR=/app/apps/client/dist \
    DISABLE_AUTOUPDATER=1 \
    HOME=/home/node
USER node
EXPOSE 8742
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8742/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
