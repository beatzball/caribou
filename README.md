# Caribou

A Mastodon client built on Litro + Elena. Ships to caribou.quest.

## Monorepo layout

- `apps/caribou-elena` — the primary Caribou app (Elena adapter, SSR).
- `packages/*` — shared workspace packages (tsconfig, eslint config, and future framework-agnostic Mastodon/auth/state code).

## Prerequisites

- Node 22+
- pnpm 10.28+ (via corepack: `corepack enable`)

## Getting started

```
pnpm install
pnpm dev
```

Open http://localhost:3000.

For OAuth round-trips against real Mastodon instances, use the Portless HTTPS tunnel:

```
pnpm dev:portless
```

## Testing

```
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## Contributing

Every PR must include a changeset (or an explicit `--empty` one for docs-only changes):

```
pnpm changeset
```

All work happens in disposable worktrees off `main`; PRs are squash-merged.

## Design

See `docs/superpowers/specs/2026-04-21-caribou-v1-design.md`.
