import { defineEventHandler } from 'h3'

const version = process.env.GIT_SHA ?? 'dev'

export default defineEventHandler(() => {
  return {
    status: 'ok' as const,
    version,
  }
})
