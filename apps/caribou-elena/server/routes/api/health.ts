import { defineEventHandler } from 'h3'
import { GIT_SHA, PACKAGE_VERSION } from '../../build-meta.generated.js'

export default defineEventHandler(() => {
  return {
    status: 'ok' as const,
    commit: GIT_SHA,
    version: PACKAGE_VERSION,
  }
})
