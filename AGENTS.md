# Agent guidance

This file gives consistent instructions to coding agents working in this
repo (Claude Code, Copilot, Codex, etc.). Humans should follow it too.

## Personal identifiers

Never embed a real contributor's identifying information in code, docs,
fixtures, mock data, commit messages, branch names, or test output.
Identifying information includes: real names, usernames, email addresses,
hostnames tied to a person, and absolute home paths.

Use placeholder shapes instead:

- Paths: `~/`, `$HOME`, or paths relative to the repo root. Never
  `/Users/<username>/…` or `/home/<username>/…`.
- Names: `alice`, `bob`, `example-user`, or domain-appropriate stand-ins.
- Emails: `alice@example.com`, `user@example.test`.
- Mastodon-style handles in fixtures: `@alice@example.social`.

If a contributor's actual identity has already been collaborator-disclosed
(e.g., a `Co-Authored-By:` trailer the author asked for), that is its own
explicit channel and not the same as embedding identifiers in code.

## Why

Repositories outlive individual contributors and get cloned, mirrored, and
indexed in places we don't control. A username or absolute home path that
slips into a comment or a snapshot file is effectively permanent. Shape-
generic placeholders keep examples readable without leaking personal
context.

## Enforcement

A pre-commit hook at `scripts/git-hooks/pre-commit` blocks the most common
mechanical leak (absolute home paths). It is wired automatically by
`scripts/install-git-hooks.mjs`, which `pnpm install` runs through the
root `prepare` script. To verify it is active:

```
git config --get core.hooksPath
# expected: scripts/git-hooks
```

The hook only knows generic shapes — it cannot catch every personal
identifier (e.g., a stray real handle in mock data). Treat the rule above
as the source of truth and the hook as a backstop.

If you have a genuine, documented need for a literal absolute path in
committed content, bypass with `git commit --no-verify` and explain the
reason in the commit message.

## Release token expires 2026-11-30

`.github/workflows/release.yml` opens the `chore: version packages` pull
request with the `CHANGESETS_TOKEN` secret, a fine-grained token (Contents
write, Pull requests write). A pull request opened with it starts its own
checks. The token expires on **2026-11-30**.

When it expires, nothing fails. The workflow falls back to `GITHUB_TOKEN`.
GitHub does not run checks for a pull request that `github-actions[bot]`
opens, so the release pull request waits for a person to click **Approve
and run**. `gh pr checks` then says "no checks reported on the
'changeset-release/main' branch". That looks like no CI, but it is this.

To check:

```
gh secret list -R beatzball/caribou        # CHANGESETS_TOKEN is listed
gh run list --branch changeset-release/main --limit 1
# action_required = the token is expired or missing; renew it
```

`changesets/action` runs with `commitMode: "github-api"`: it writes the
release commit through the GitHub API with this token, not with a git push.
So the commit and the pull request are both by the token's owner. Do not go
back to the default `git-cli` mode: its push uses the credential that
`actions/checkout` stored (`GITHUB_TOKEN`), and then every update to an open
release PR waits for approval.

Renew the token before 2026-11-30 and update the secret. Keep the
`|| secrets.GITHUB_TOKEN` fallback.
