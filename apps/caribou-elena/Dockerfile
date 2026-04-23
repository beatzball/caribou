# syntax=docker/dockerfile:1.7

# Stage 1: build
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
RUN pnpm --filter caribou-elena build

# Stage 2: runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
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
