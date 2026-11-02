#!/usr/bin/env bash
# Deploy one tested image to a Coolify "Docker Image" app, and wait for it.
# CI's deploy job runs this on the pinned path; docs/deploy.md explains it.
#
# Needs: COOLIFY_API_URL, COOLIFY_API_TOKEN, COOLIFY_APP_UUID, GITHUB_SHA,
# IMAGE (ghcr.io/<repo>:<sha>), RUNNER_TEMP. Needs curl and jq.
#
# The token goes to curl through a header file, never argv. curl's stderr is
# dropped, so a connection error cannot print the Coolify host; the script
# prints its own error instead.
#
# The tag is put back on the previous image only when this deploy surely did
# not change production: no deploy was requested yet, Coolify clearly refused
# it (a 4xx with its own error body), or Coolify reported it failed or
# cancelled (Docker Image apps use a rolling update, so the old container
# keeps serving). When the outcome is unknown (no answer, a 5xx or gateway
# error, a timeout, or a deploy Coolify did not queue), the script leaves the
# tag alone, and fails with the steps to check by hand.
set -euo pipefail

# Test hooks. CI uses the defaults.
POLL_SECONDS=${COOLIFY_POLL_SECONDS:-10}
WAIT_BUDGET=${COOLIFY_WAIT_BUDGET:-240}     # for another deployment to end
DEPLOY_BUDGET=${COOLIFY_DEPLOY_BUDGET:-480} # for this deployment to finish

api="${COOLIFY_API_URL%/}"
auth="$RUNNER_TEMP/coolify-auth"
body="$RUNNER_TEMP/coolify-body"
trap 'rm -f "$auth" "$body"' EXIT
printf 'Authorization: Bearer %s\n' "$COOLIFY_API_TOKEN" > "$auth"

# call METHOD PATH [curl args]: the body goes to $body, the HTTP status to
# stdout ("000" when there is no answer).
call() {
  local method=$1 path=$2
  shift 2
  curl -sS --connect-timeout 10 --max-time 30 -o "$body" -w '%{http_code}' \
    -X "$method" -H @"$auth" "$@" "$api$path" 2>/dev/null || true
}
fail() {
  echo "::error::$1"
  exit 1
}
set_tag() {
  local data code
  data=$(jq -nc --arg name "${IMAGE%:*}" --arg tag "$1" \
    '{docker_registry_image_name: $name, docker_registry_image_tag: $tag}')
  code=$(call PATCH "/applications/$COOLIFY_APP_UUID" -H 'Content-Type: application/json' --data "$data")
  [[ "$code" == 2?? ]]
}

previous=""
# Production did not change: put the tag back, so a manual Redeploy in
# Coolify runs the image production runs, not this one.
fail_and_restore() {
  if [[ -n "$previous" && "$previous" != "$GITHUB_SHA" ]]; then
    if set_tag "$previous"; then
      echo "::warning::The Coolify app tag is back on $previous."
    else
      echo "::warning::Could not set the Coolify app tag back to $previous. Set it by hand."
    fi
  fi
  fail "$1"
}
# Production may or may not have changed. Leave the tag on this SHA.
fail_unknown() {
  echo "The state in Coolify is unknown. The app tag stays on ${GITHUB_SHA}."
  echo "Check by hand:"
  echo "  1. In Coolify, open the app's Deployments. Wait until none is queued or in progress."
  echo "  2. Run: curl -sS https://caribou.quest/api/health"
  echo "  3. If 'commit' is ${GITHUB_SHA}, the deploy worked. Re-run this workflow's failed jobs to run verify-prod."
  echo "  4. Otherwise re-run this workflow's failed jobs to deploy again, or set the app's image tag to the"
  echo "     commit that /api/health reports (previous tag: ${previous:-none}) so Redeploy keeps that image."
  fail "$1"
}

# 1. Wait until no deployment of this app is queued or running. Coolify skips
# a deploy request while one for the same app is active, and still answers
# with a deployment id that does not exist.
deadline=$((SECONDS + WAIT_BUDGET))
while :; do
  code=$(call GET "/deployments/applications/$COOLIFY_APP_UUID?take=20")
  [[ "$code" == 2?? ]] || fail "Could not list the app's Coolify deployments (HTTP $code)."
  active=$(jq -r '[.deployments[]? | select(.status == "queued" or .status == "in_progress")] | length' "$body" 2>/dev/null || true)
  [[ "$active" =~ ^[0-9]+$ ]] || fail "Could not read the app's Coolify deployments."
  ((active == 0)) && break
  ((SECONDS < deadline)) || fail "Another Coolify deployment of the app is still active. Not deploying."
  echo "Waiting for $active active Coolify deployment(s) to end"
  sleep "$POLL_SECONDS"
done

# 2. The app must be a Docker Image app. Remember its current tag.
code=$(call GET "/applications/$COOLIFY_APP_UUID")
[[ "$code" == 2?? ]] || fail "Could not read the Coolify app (HTTP $code)."
pack=$(jq -r '.build_pack' "$body")
[[ "$pack" == dockerimage ]] || fail "The Coolify app is not a Docker Image app (build_pack: $pack). Not deploying. See docs/deploy.md."
previous=$(jq -r '.docker_registry_image_tag // empty' "$body")

# 3. Point the app at the tested image, and read it back.
set_tag "$GITHUB_SHA" || fail_and_restore "Could not set the Coolify app tag."
code=$(call GET "/applications/$COOLIFY_APP_UUID")
tag=$(jq -r '.docker_registry_image_tag // empty' "$body" 2>/dev/null || true)
[[ "$code" == 2?? && "$tag" == "$GITHUB_SHA" ]] || fail_and_restore "The Coolify app tag did not change to ${GITHUB_SHA} (got '$tag')."

# 4. Start the deploy. The answer must be for this app and carry an id.
# Only a 4xx with Coolify's own JSON error body is a clear refusal. No answer
# (000), a 5xx, or a gateway or proxy page may come after Coolify already
# queued the deployment, so the outcome is unknown.
code=$(call POST "/deploy?uuid=$COOLIFY_APP_UUID&force=false")
if [[ "$code" != 2?? ]]; then
  refusal=$(jq -r 'select(type == "object") | .message | strings' "$body" 2>/dev/null || true)
  if [[ "$code" == 4?? && -n "$refusal" ]]; then
    fail_and_restore "Coolify refused the deploy (HTTP $code): $refusal"
  fi
  fail_unknown "The deploy request got no clear answer (HTTP $code). Coolify may have queued it."
fi
resource=$(jq -r '.deployments[0].resource_uuid // empty' "$body")
deployment=$(jq -r '.deployments[0].deployment_uuid // empty' "$body")
message=$(jq -r '.deployments[0].message // empty' "$body")
[[ "$resource" == "$COOLIFY_APP_UUID" ]] || fail_unknown "Coolify answered for a different resource. Message: $message"
[[ -n "$deployment" ]] || fail_unknown "Coolify did not return a deployment id. Message: $message"
echo "Coolify deployment $deployment for $IMAGE: $message"

# 5. Wait for it. A 404 means Coolify did not queue it: something else may be
# deploying, maybe with this tag, so the outcome is unknown.
deadline=$((SECONDS + DEPLOY_BUDGET))
misses=0
status=unknown
while ((SECONDS < deadline)); do
  code=$(call GET "/deployments/$deployment")
  if [[ "$code" == 404 ]]; then
    misses=$((misses + 1))
    ((misses < 3)) || fail_unknown "Coolify has no deployment $deployment; it did not queue the deploy. Message: $message"
  elif [[ "$code" == 2?? ]]; then
    misses=0
    status=$(jq -r '.status // "unknown"' "$body" 2>/dev/null || echo unknown)
    case "$status" in
      finished)
        # Read the tag back. Only a real mismatch fails; production is
        # already deployed, and verify-prod checks the commit anyway.
        for _ in 1 2 3; do
          code=$(call GET "/applications/$COOLIFY_APP_UUID")
          if [[ "$code" == 2?? ]]; then
            tag=$(jq -r '.docker_registry_image_tag // empty' "$body" 2>/dev/null || true)
            [[ "$tag" == "$GITHUB_SHA" ]] || fail "Deployment finished, but the Coolify app tag is now '$tag', not ${GITHUB_SHA}. Someone changed it during the deploy."
            echo "Deployed $IMAGE"
            exit 0
          fi
          sleep "$POLL_SECONDS"
        done
        echo "::warning::Deployment finished, but the Coolify app could not be read back (HTTP $code). verify-prod checks the commit."
        echo "Deployed $IMAGE"
        exit 0
        ;;
      failed | cancelled*)
        fail_and_restore "Coolify deployment $deployment ended as $status."
        ;;
    esac
  else
    echo "Coolify status check answered HTTP $code; trying again"
  fi
  sleep "$POLL_SECONDS"
done

# 6. Out of time. Ask Coolify to cancel, but do not touch the tag: the
# deployment may have finished, or may still finish, with this image.
code=$(call POST "/deployments/$deployment/cancel")
if [[ "$code" == 2?? ]]; then
  echo "Coolify accepted the cancel of $deployment."
else
  echo "Coolify did not accept the cancel of $deployment (HTTP $code)."
fi
fail_unknown "Coolify deployment $deployment did not finish in time (last status: $status)."
