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
   re-run), it keeps the existing image. If GHCR gives any answer other than
   a clear "manifest unknown", the job fails and pushes nothing. So a SHA tag
   is never overwritten.
3. `deploy-gate` checks that main has not moved past this commit. If it has,
   the newer run deploys instead.
4. `deploy` takes the `deploy-prod` lock, checks main again, and runs
   `scripts/ci/coolify-deploy.sh`. The script:
   - waits up to 4 minutes until no Coolify deployment of the app is queued
     or running,
   - sets the app's image tag to the commit SHA,
   - starts a deploy and checks that Coolify answered for this app,
   - waits up to 8 minutes until Coolify reports `finished`.
5. `verify-prod` checks that `https://caribou.quest/api/health` reports the
   same commit, and that `https://caribou.quest/oauth/client-metadata.json`
   names itself as its `client_id`. That second check fails when the app's
   `PUBLIC_BASE_URL` is unset or is not `https://caribou.quest`.

The handle resolver's rate limit trusts the last `X-Forwarded-For` entry. So
the app must only be reachable through the proxy (Coolify's Traefik), which
adds that entry; a client that reaches the container directly can set it.

Coolify never builds the app. It only pulls and runs the tested image.

`node --test scripts/ci/` tests the script against a fake Coolify. CI runs
it in the `checks` job.

### When the deploy does not finish

| what happened | production | the app's tag | the job |
|---|---|---|---|
| Coolify clearly refused the deploy (a 4xx with Coolify's own error message), or reported `failed` or `cancelled` | not changed (Docker Image apps use a rolling update; the old container keeps serving) | set back to the previous SHA | fails |
| The deploy request got no answer, a 5xx, or a gateway or proxy error page | **unknown** (Coolify may have queued it before the answer was lost) | left on the new SHA | fails and prints the steps below |
| Coolify did not queue the deploy, or it did not finish in 8 minutes | **unknown** | left on the new SHA | asks Coolify to cancel (on a timeout), then fails and prints the steps below |

When the state is unknown:

1. In Coolify, open the app's *Deployments*. Wait until none is queued or in
   progress.
2. Run `curl -sS https://caribou.quest/api/health`.
3. If `commit` is the run's SHA, the deploy worked. Re-run the run's failed
   jobs, so `verify-prod` runs.
4. If not, re-run the failed jobs to deploy again. Or set the app's image
   tag to the commit that `/api/health` reports, so **Redeploy** keeps that
   image.

There is no `:main` or `:latest` tag. **Redeploy** in Coolify runs the
image with the app's current tag.

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
- **A manual Redeploy at the same time as CI.** The script waits for active
  deployments to end first. A Redeploy clicked after that wait and before
  CI's own deploy starts can still make Coolify skip CI's request. The job
  then fails within about 30 seconds and prints the steps above.

## Migration from the Git/Dockerfile app

Production now runs a Coolify app that builds from Git with
`apps/caribou/Dockerfile`. CI reaches it through `COOLIFY_WEBHOOK_URL`. Do
these steps in order. The old app serves `caribou.quest` until step 13.
Some steps run on the Coolify server, over SSH.

### Prepare (production does not change)

1. **Merge the PR.** CI still uses the webhook, with a warning. Each push to
   main now also pushes an image to GHCR. Wait for one push to main to
   finish, so an image exists. If `publish-image` fails with "Could not get
   a GHCR token" on this first push, GHCR refused a pull token for a package
   that does not exist yet. Nothing unsafe happened; report it, because the
   check then needs a first-push exception.
2. **GHCR pull access.** Make the package `beatzball/caribou` public
   (GitHub, the package page, *Package settings*, *Change visibility*).
   Or log the Coolify server in to `ghcr.io` with a token that has
   `read:packages`.
3. **Old app: auto deploy off.** In the old app, turn *Auto Deploy* off if
   it is on. From now on only CI may deploy it.
4. **Server: keep unused volumes.** In Coolify, open the server, *Docker
   Cleanup*. Turn **Delete Unused Volumes** off. Reason: the new app uses
   the old app's data folder through a directory mount (step 7). Docker does
   not count that as a use of the volume. Once the old app stops, a cleanup
   with this setting on runs `docker volume prune -af` and deletes the
   production data.

### Build the new app

5. **New app.** In Coolify, in the same project and server, add a resource
   of type **Docker Image**. Image `ghcr.io/beatzball/caribou`, tag: the
   full SHA of the commit from step 1. Do not give it a domain. Leave *Auto
   Deploy* off.
6. **Settings.** Copy from the old app:
   - all env vars (including `PUBLIC_BASE_URL`),
   - **Ports Exposes** `3000`. Do not add a *Ports Mappings* entry: a host
     port mapping turns off Coolify's rolling update, so every deploy would
     stop the old container before the new one is up.
   - the health check, and make sure it is **enabled** (path
     `/api/health`, port `3000`). The rolling update waits on it.
7. **Mount the same data.** The old app keeps its state in a Docker volume
   at `/data`: the OAuth app registrations (`/data/apps/...`) and sign-in
   state. Do **not** add a *Volume Mount* with the old volume's name:
   Coolify puts the new app's UUID in front of the name, so you get a new,
   empty volume and every user is signed out. Instead:
   1. On the server, find the old app's container and its `/data` source.
      Use the old app's UUID from its Coolify URL:
      ```
      old=$(docker ps --filter "name=<old app uuid>" --format '{{.Names}}' | head -1)
      docker inspect "$old" --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Source}} -> {{.Destination}}{{println}}{{end}}'
      ```
      The line that ends in `-> /data` is `volume <name> <source>`. The
      source looks like `/var/lib/docker/volumes/<name>/_data`.
   2. In the new app, *Persistent Storage*, *Add*, **Directory Mount**.
      Source path: that source. Destination path: `/data`.
      On deploy, Coolify runs `mkdir -p` on the source path; the folder
      exists, so nothing changes.
   3. **Never press Delete on this mount.** Check the Coolify version
      (*Settings*). Coolify 4.4.0 and later never delete a directory outside
      the app's own folder. Older versions (4.3.x and below) run `rm -rf` on
      the source path, and the delete dialog ticks "permanently deleted from
      the server" by default: that deletes the production data. Deleting the
      whole app does not remove the folder on any version.
8. **Start it.** Deploy the new app once from Coolify.
9. **Prove the data is there, before any traffic moves.** On the server:
   ```
   new=$(docker ps --filter "name=<new app uuid>" --format '{{.Names}}' | head -1)
   docker inspect "$new" --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{println}}{{end}}'
   ```
   It must print `bind <the source from step 7> -> /data`. Then compare the
   app registrations in both containers:
   ```
   for c in "$old" "$new"; do
     docker exec "$c" sh -c 'cd /data && find apps -type f | sort | xargs -r sha256sum | sha256sum; find apps -type f | wc -l'
   done
   ```
   Both containers must print the same hash and the same count, and the
   count must not be 0. Then check that the new container can write there:
   ```
   docker exec "$new" sh -c 'touch /data/.write-check && rm /data/.write-check' && echo writable
   ```
   If any check fails, stop here. Production is not affected. Fix the mount
   and repeat from step 8.
10. **API token.** In Coolify, *Keys & Tokens*, make an API token with
    `read`, `write` and `deploy`. Save it as the repo secret
    `COOLIFY_API_TOKEN` (the old one may lack `write`). The webhook path
    uses the same secret, so the next deploy checks the new token.

### Switch

11. **Pause deploys.** Do not merge to main until step 14 is done. In the
    repo's *Actions* tab, wait until no CI run on main is in progress. The
    webhook path does not wait for Coolify, so also check, in Coolify, that
    neither app has a deployment queued or in progress.
12. **Flip CI to the pinned path.** Add the repo secrets `COOLIFY_API_URL`
    (for example `https://<coolify host>/api/v1`) and `COOLIFY_APP_UUID`
    (the new app's UUID). Add both. **From the next push to main, CI deploys
    the new app.**
13. **Move the domain.** Coolify writes the domain into the container's
    routing labels at deploy time, and refuses a domain that another app
    uses. So:
    1. On the **old** app, remove `caribou.quest` and save. Do not restart or
       redeploy it. Its running container keeps its labels and keeps
       serving.
    2. On the **new** app, add `caribou.quest` and save.
    3. On the new app, click **Redeploy**. This applies the new labels.
    4. Check: `curl -sS https://caribou.quest/api/health` shows the new
       app's commit. Sign in once: an existing account still works.
14. **Stop the old app.** Deploys may resume. The next push to main deploys
    the new app and its `verify-prod` checks it.

### Clean up

15. Delete the repo secret `COOLIFY_WEBHOOK_URL`.
16. When you are sure, delete the old app. In the delete dialog, **untick
    "Delete volumes"** (it is ticked by default). Do not remove the volume
    from the old app's *Persistent Storage* list either: that runs
    `docker volume rm -f`. The new app uses that volume's data.
17. Keep **Delete Unused Volumes** off (step 4) for as long as the new app
    mounts the old volume's folder.

### Going back

- **Before step 12:** nothing to undo. The old app still serves and CI
  still deploys it. Stop or delete the new app (with *Delete volumes*
  unticked).
- **After step 12, before step 13:** delete `COOLIFY_API_URL` and
  `COOLIFY_APP_UUID`. CI uses the webhook again.
- **After step 13:** do these in order. The new app keeps serving until
  the old one is back.
  1. Pause deploys as in step 11.
  2. On the **new** app, remove `caribou.quest` and save. Do not restart or
     redeploy it. Its running container keeps its labels and keeps
     serving.
  3. On the **old** app, add `caribou.quest`, save, and **Redeploy** it (it
     builds main). Its new container carries the domain.
  4. Check `curl -sS https://caribou.quest/api/health`. If the old app's
     deploy failed, stop here: the new app still serves. Fix the old app
     first.
  5. Stop the new app.
  6. Delete `COOLIFY_API_URL` and `COOLIFY_APP_UUID`. Deploys may resume;
     CI uses the webhook again.

## App env vars for Bluesky

Set these on the app in Coolify, next to `PUBLIC_BASE_URL`. Both are read at
runtime; changing one needs a restart, not a new image.

| var | default | what it does |
|---|---|---|
| `BLUESKY_SSR` | unset (on) | The kill switch. The server renders Bluesky profiles and threads for signed-out readers unless this is `0`, `false`, `off` or `no`, in any case. The server logs `[caribou] Bluesky SSR is on` or `is off` once at start, so check the log after a restart (`apps/caribou/README.md`, "Bluesky SSR"). With it `0`, a dotted `/@name` or a `/@did:…` route renders as a Mastodon route on the server, and only a Bluesky account sees the Bluesky page, after the client loads. Set it to `0` only to stop Bluesky fetches in an incident. |
| `BLUESKY_PUBLIC_APPVIEW` | `https://public.api.bsky.app` | The only host the server asks for Bluesky data. An http(s) origin. The server does not follow its redirects. |

## Repository secrets

| secret | path | value |
|---|---|---|
| `COOLIFY_API_URL` | pinned | Coolify API base, for example `https://coolify.example.com/api/v1` |
| `COOLIFY_APP_UUID` | pinned | UUID of the Docker Image app |
| `COOLIFY_API_TOKEN` | both | Coolify API token with `read`, `write` and `deploy` |
| `COOLIFY_WEBHOOK_URL` | webhook | Coolify deploy webhook of the old app |

## Roll back

Re-running CI for an older commit does not roll back: the "main has moved"
guard skips its deploy. Instead, wait until no CI deploy runs, then in
Coolify set the app's image tag to the SHA of an earlier commit that
deployed and passed `verify-prod`, and click **Redeploy**. The next push to
main deploys over it again.
