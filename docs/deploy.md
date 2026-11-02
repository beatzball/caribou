# Deploy

The goal: production runs the exact image that passed CI.

The `deploy` job in `.github/workflows/ci.yml` has two paths:

| path | when | pinned to the tested commit? |
|---|---|---|
| **pinned** | secrets `COOLIFY_API_URL` and `COOLIFY_APP_UUID` are set | yes |
| **webhook** | only `COOLIFY_WEBHOOK_URL` is set | no, and the job warns |

If only one of `COOLIFY_API_URL` and `COOLIFY_APP_UUID` is set, or no path
is set, `deploy` fails and deploys nothing.

The webhook path is the old one. It stays only until the migration below is
done.

## How a push to main deploys (pinned path)

1. `smoke-image` builds the Docker image, runs it and probes it. It saves the
   tested image as a run artifact.
2. `publish-image` pushes those same bytes to GHCR as
   `ghcr.io/beatzball/caribou:<commit sha>`. If that tag already exists (a
   re-run), it keeps the existing image. A SHA tag is never overwritten.
3. `deploy-gate` checks that main has not moved past this commit. If it has,
   the newer run deploys instead.
4. `deploy` takes the `deploy-prod` lock and checks main again. Then it:
   - waits until no Coolify deployment of the app is queued or running,
   - sets the app's image tag to the commit SHA,
   - starts a deploy, checks that Coolify really queued it,
   - waits until Coolify reports `finished`.
   If the deploy fails or times out, it cancels it and sets the tag back to
   the image production runs.
5. `verify-prod` checks that `https://caribou.quest/api/health` reports the
   same commit.

Coolify never builds the app. It only pulls and runs the tested image.

There is no `:main` or `:latest` tag. The app's tag is the SHA of the last
deploy CI started and did not roll back. So **Redeploy** in Coolify runs that
image again.

## Races that are left

- **Two runs at the deploy lock.** GitHub keeps one pending job per
  concurrency group. If B (main's head) waits for the lock, a later job can
  replace it. `deploy-gate` stops stale runs before they reach the lock, so
  only a newer commit's deploy can replace B, and that one deploys the newer
  commit. A small window is left: main can move between `deploy-gate` and
  the lock. Then nothing deploys until the next push to main.
- **verify-prod runs outside the lock.** If a newer deploy finishes before an
  older run's `verify-prod`, the older run goes red although production is
  right. Check the newest run on main.
- **A manual Redeploy at the same time as CI.** `deploy` waits for it to
  end first. A Redeploy clicked after that wait and before CI's own deploy
  starts can still make Coolify skip CI's request. The job then fails within
  about 30 seconds with "did not queue the deploy". Re-run the job.

## Migration from the Git/Dockerfile app

Production now runs a Coolify app that builds from Git with
`apps/caribou/Dockerfile`. CI reaches it through `COOLIFY_WEBHOOK_URL`. Do
these steps in order. The old app serves `caribou.quest` until step 9.

1. **Merge the PR.** Nothing changes for production. CI still uses the
   webhook, with a warning. Each push to main now also pushes an image to
   GHCR. Wait for one push to main to finish, so an image exists.
2. **GHCR pull access.** Make the package `beatzball/caribou` public
   (GitHub, the package page, *Package settings*, *Change visibility*).
   Or log the Coolify server in to `ghcr.io` with a token that has
   `read:packages`. Do this now, before CI needs it.
3. **New app.** In Coolify, in the same project and server, add a resource
   of type **Docker Image**. Image `ghcr.io/beatzball/caribou`, tag: the
   full SHA of the commit from step 1. Do not give it a domain yet. Turn
   auto deploy off.
4. **Settings.** Copy from the old app: all env vars (including
   `PUBLIC_BASE_URL`), port `3000`, the health check.
5. **Keep the data.** The old app keeps state in a volume at `/data`
   (OAuth app registrations and sessions). A new empty volume signs every
   user out and breaks saved instance cookies. Give the new app the
   **same** volume: in its *Persistent Storage*, add a volume with the
   **same name** as the old app's `/data` volume, mounted at `/data`. Check
   the name under the old app's *Persistent Storage*.
6. **Start it.** Deploy the new app once from Coolify. Check its logs: the
   server starts and finds its data.
7. **API token.** In Coolify, *Keys & Tokens*, make an API token with
   `read`, `write` and `deploy`. Save it as the repo secret
   `COOLIFY_API_TOKEN` (the old one may lack `write`). The webhook path
   uses the same secret, so the next deploy checks the new token.
8. **Flip CI to the pinned path.** Add the repo secrets `COOLIFY_API_URL`
   (for example `https://<coolify host>/api/v1`) and `COOLIFY_APP_UUID`
   (the new app's UUID, from its URL or *General* page). Add both before the
   next push to main. **From the next push to main, CI deploys the new app.**
   Until step 9, its `verify-prod` fails, because `caribou.quest` still
   points at the old app. That is expected.
9. **Move the domain.** Coolify writes the domain into the container's
   routing labels at deploy time, and refuses a domain that another app
   uses. So:
   1. On the **old** app, remove `caribou.quest` and save. Do not restart or
      redeploy it. Its running container keeps its labels and keeps
      serving.
   2. On the **new** app, add `caribou.quest` and save.
   3. On the new app, click **Redeploy**. This applies the new labels.
   4. Check: `curl -sS https://caribou.quest/api/health` shows the new
      app's commit.
10. **Stop the old app.** Then re-run the red `verify-prod` job of the last
    run on main. It passes.
11. **Clean up.** Delete the repo secret `COOLIFY_WEBHOOK_URL`. When you are
    sure, delete the old app. Do not delete its volume: the new app uses it.

If the new app fails at step 6 or step 9, the old app still serves. To go
back after step 8, delete `COOLIFY_API_URL` and `COOLIFY_APP_UUID`; CI
uses the webhook again.

## Repository secrets

| secret | path | value |
|---|---|---|
| `COOLIFY_API_URL` | pinned | Coolify API base, for example `https://coolify.example.com/api/v1` |
| `COOLIFY_APP_UUID` | pinned | UUID of the Docker Image app |
| `COOLIFY_API_TOKEN` | both | Coolify API token with `read`, `write` and `deploy` |
| `COOLIFY_WEBHOOK_URL` | webhook | Coolify deploy webhook of the old app |

## Roll back

Re-running CI for an older commit does not roll back: the "main has moved"
guard skips its deploy. Instead, in Coolify set the app's image tag to the
SHA of an earlier commit that deployed and passed `verify-prod`, and click
**Redeploy**. The next push to main deploys over it again.
