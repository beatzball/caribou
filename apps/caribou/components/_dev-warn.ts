// Vite sets `import.meta.env.DEV` in dev and in vitest and turns it into
// `false` in a production client build. The server bundle may have no
// `import.meta.env` at all, so a missing env counts as production.
export function devWarn(message: string): void {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.warn(message)
}
