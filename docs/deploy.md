# Deploy

Production runs the exact image that passed CI.

## How a push to main deploys

1. `smoke-image` builds the Docker image, runs it and probes it.
2. If the probe passes, it pushes that image to GHCR as
   `ghcr.io/beatzball/caribou:<commit sha>`.
3. `deploy` checks that main has not moved past this commit. If it has, the
   newer run deploys instead.
4. `deploy` sets the Coolify app's image tag to the commit SHA through the
   Coolify API, starts a deploy and waits until Coolify reports `finished`.
5. `verify-prod` checks that `https://caribou.quest/api/health` reports the
   same commit.

Coolify never builds the app. It only pulls and runs the tested image.

There is no `:main` or `:latest` tag. Coolify keeps the last deployed SHA
as its tag, so **Redeploy** in Coolify runs the same tested image again.

## Coolify setup

The app in Coolify is a **Docker Image** resource (build pack
`dockerimage`), not a Dockerfile or Git resource. Its image is
`ghcr.io/beatzball/caribou`. It needs:

- a persistent volume mounted at `/data` (`STORAGE_DIR`),
- port `3000`,
- the runtime env vars, including `PUBLIC_BASE_URL`,
- the domain `caribou.quest`,
- auto deploy off. CI starts every deploy.

The GHCR package must be public, or the Coolify server must be logged in to
`ghcr.io` with a token that can read packages.

## Repository secrets

| secret | value |
|---|---|
| `COOLIFY_API_URL` | Coolify API base, for example `https://coolify.example.com/api/v1` |
| `COOLIFY_API_TOKEN` | Coolify API token with read, write and deploy permission |
| `COOLIFY_APP_UUID` | UUID of the Docker Image app |

If one is missing, `deploy` fails with an error that names it. It does not
deploy anything else.

## Roll back

Re-running CI for an older commit does not roll back: the "main has moved"
guard skips its deploy. Instead, in Coolify set the image tag to an
older commit SHA that is still in GHCR and click **Redeploy**.
