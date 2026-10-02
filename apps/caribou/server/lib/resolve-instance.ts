import type { H3Event } from 'h3'
import { getInstance, type InstanceDeps } from './instance-cookie.js'

export type ResolvedInstance =
  | { instance: string; source: 'path' | 'cookie' }
  | { instance: null }

export async function resolveInstanceForRoute(
  event: H3Event,
  params: { handle?: string },
  deps: InstanceDeps,
): Promise<ResolvedInstance> {
  const handle = params.handle ?? ''
  const m = /^@?[^@]+@([^@/?#]+)$/.exec(handle)
  if (m) return { instance: m[1] as string, source: 'path' }
  const cookieHost = await getInstance(event, deps)
  if (cookieHost) return { instance: cookieHost, source: 'cookie' }
  return { instance: null }
}
