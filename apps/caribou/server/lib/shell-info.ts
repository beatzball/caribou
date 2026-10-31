import type { ResolvedInstance } from './resolve-instance.js'
import type { ShellInfo } from './page-data-types.js'

/** The shell's instance and where it came from, for the page data. */
export function shellInfo(resolution: ResolvedInstance): ShellInfo {
  return resolution.instance ? { instance: resolution.instance, source: resolution.source } : { instance: null }
}
