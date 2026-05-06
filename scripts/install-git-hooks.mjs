#!/usr/bin/env node
/* eslint-disable no-console */
// Wires the pre-commit hook by pointing core.hooksPath at the tracked
// directory. Runs from `prepare` on `pnpm install`. Skipped on CI and
// outside a git checkout.
import { execSync } from 'node:child_process'

if (process.env.CI) process.exit(0)
try {
  execSync('git rev-parse --git-dir', { stdio: 'ignore' })
} catch {
  process.exit(0)
}

const current = (() => {
  try { return execSync('git config --get core.hooksPath', { encoding: 'utf8' }).trim() }
  catch { return '' }
})()
if (current === 'scripts/git-hooks') process.exit(0)
execSync('git config core.hooksPath scripts/git-hooks')
console.log('caribou: git core.hooksPath -> scripts/git-hooks')
