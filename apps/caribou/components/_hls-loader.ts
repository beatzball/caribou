import type * as HlsModule from 'hls.js'

// hls.js, loaded on the first press of play only, in its own chunk
// (README, "Bluesky video", rule 4). Its own module, so a test can count
// the loads.
export const loadHls = (): Promise<typeof HlsModule> => import('hls.js')
