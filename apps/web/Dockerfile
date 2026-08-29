FROM node:22-bookworm-slim AS builder

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @prosepect/web --include-workspace-root

COPY apps/web apps/web
RUN npm run build:web

FROM caddy:2.10-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /workspace/apps/web/dist /srv
EXPOSE 80
