import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

const base = process.env.STORAGE_DIR ?? './.data'

let cached: ReturnType<typeof createStorage> | null = null

export function getStorage() {
  if (!cached) cached = createStorage({ driver: fsDriver({ base }) })
  return cached
}

export interface OAuthApp {
  client_id: string
  client_secret: string
  vapid_key: string
  registered_at: number
}

export interface StateEntry {
  server: string
  origin: string
  createdAt: number
  // SHA-256 (hex) of the nonce in the starting browser's `caribou.signin`
  // cookie. The callback must bring that cookie (`signin-binding.ts`).
  nonceHash: string
  // Set when a signed-in reader adds another account (`/?add`). An error
  // then goes back to the add form, not the plain landing.
  add?: true
}

export const APP_TTL_MS   = 7 * 24 * 60 * 60 * 1000
export const STATE_TTL_MS = 10 * 60 * 1000

export function appKey(server: string, origin: string)   { return `apps:${server}:${origin}` }
export function stateKey(value: string)                  { return `state:${value}` }
