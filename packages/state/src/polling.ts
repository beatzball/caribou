export interface PollHost {
  visibilityState: DocumentVisibilityState
  addVisibilityListener(listener: () => void): () => void
}

export function defaultPollHost(): PollHost {
  return {
    get visibilityState() { return document.visibilityState },
    addVisibilityListener(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export interface StartPollingOpts {
  intervalMs: number
  fn: () => void | Promise<void>
  host?: PollHost
}

export function startPolling(opts: StartPollingOpts): () => void {
  const host = opts.host ?? defaultPollHost()
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  function startTimer() {
    if (timer !== null) return
    timer = setInterval(() => { void opts.fn() }, opts.intervalMs)
  }
  function stopTimer() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const unlisten = host.addVisibilityListener(() => {
    if (stopped) return
    if (host.visibilityState === 'visible') {
      void opts.fn()
      startTimer()
    } else {
      stopTimer()
    }
  })

  if (host.visibilityState === 'visible') startTimer()

  return () => {
    stopped = true
    stopTimer()
    unlisten()
  }
}
