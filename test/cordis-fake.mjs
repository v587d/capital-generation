/**
 * Cordis-shaped fake for host-plane `apply()`. `ctx.get('webServer')` resolving a value does not
 * make the `ctx.webServer` property access legal -- that property exists only on a ctx that
 * declared the inject -- and a fake that hung services off the outer ctx passed the wrong path
 * (green tests, real-machine throw). For host rows only; keep one copy.
 */
export function fakeCtx({ webServer, connection, services = {} } = {}) {
  const provided = new Map(Object.entries(services))
  const injected = []
  const ctx = {
    get: (name) => (name === 'webServer' ? webServer : name === 'connection' ? connection : provided.get(name)),
    provide: (name, value) => provided.set(name, value),
    effect: (callback) => {
      callback()
      return () => {}
    },
    inject: (deps, callback) => {
      injected.push({ deps, callback })
      // Real cordis: start the child fiber at once if deps are ready, else wait (row stays active).
      if (deps.every((dep) => ctx.get(dep) !== undefined)) callback(injectedCtx(deps))
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  // Accessing this property on the outer ctx must throw, else the probe-then-use path goes untested.
  Object.defineProperty(ctx, 'webServer', {
    configurable: true,
    get() {
      throw new Error('cannot get property "webServer" without inject')
    },
  })
  /** The layer handed to inject callbacks: it owns the property, so access is legal. */
  const injectedCtx = (deps) => Object.create(ctx, deps.includes('webServer')
    ? { webServer: { value: webServer, configurable: true } }
    : {})
  return { provided, injected, ctx }
}
