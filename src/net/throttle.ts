/**
 * Serialize requests to one upstream into a chain with a minimum gap. Concurrent callers must not
 * each sleep and then fire together; chaining guarantees the gap after the previous start.
 */

export function createRequestThrottle(minIntervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    // A misconfigured throttle silently means "no throttle"; upstreams answer with empty data or an IP ban.
    throw new Error(`createRequestThrottle: minIntervalMs must be a non-negative finite number, got ${String(minIntervalMs)}`)
  }
  let chain: Promise<unknown> = Promise.resolve()
  let lastStartedAt = 0
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(async () => {
      const wait = minIntervalMs - (Date.now() - lastStartedAt)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      lastStartedAt = Date.now()
      return task()
    })
    chain = result.then(() => undefined, () => undefined)
    return result
  }
}
