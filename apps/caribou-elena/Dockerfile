# syntax=docker/dockerfile:1.7

# Stage 1: build
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat git
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# The commit SHA feeding /api/health.commit comes (in order of preference)
# from: an explicit --build-arg GIT_SHA, Coolify's own SOURCE_COMMIT build
# arg (set automatically per deploy), or `git rev-parse HEAD` against the
# repo in the build context. The build script (`write-build-meta.mjs`) walks
# that chain. Coolify strips .git from the build context in some
# configurations, so the SOURCE_COMMIT fallback is what keeps the canary
# honest in prod.
ARG GIT_SHA
ARG SOURCE_COMMIT
ENV GIT_SHA=${GIT_SHA}
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
RUN echo "[build-meta env] GIT_SHA=${GIT_SHA:-<unset>} SOURCE_COMMIT=${SOURCE_COMMIT:-<unset>} .git=$(test -d .git && echo present || echo missing)" \
 && pnpm --filter caribou-elena build

# Stage 2: runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl
WORKDIR /app
RUN mkdir -p /data && chown -R node:node /data
COPY --from=builder --chown=node:node /repo/apps/caribou-elena/dist ./dist
USER node
ENV NODE_ENV=production \
    STORAGE_DIR=/data \
    PORT=3000
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/server/index.mjs"]
