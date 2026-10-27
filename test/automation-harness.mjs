import { domainSpec } from '../automation/store.js'

/** In-memory domain with the real write-boundary zod check (a bad record must throw in tests). */
export function createFakeDomain(spec = domainSpec) {
  const tables = new Map(Object.keys(spec.tables).map((name) => [name, new Map()]))
  function tableOf(name) {
    const records = tables.get(name)
    const schema = spec.tables[name].valueSchema
    return {
      get: (key) => records.get(key),
      *entries() { yield* records.entries() },
      *keys() { yield* records.keys() },
      get size() { return records.size },
      async put(key, value) {
        schema.parse(value)
        records.set(key, value)
      },
      async delete(key) { return records.delete(key) },
      async update(key, fn) {
        if (!records.has(key)) throw new Error('missing-key')
        const next = fn(records.get(key))
        schema.parse(next)
        records.set(key, next)
        return next
      },
    }
  }
  const domain = {
    name: spec.name,
    table: (name) => tableOf(name),
    close: async () => {},
  }
  return { domain, tables, records: tables }
}

export function fakeContext(initial = {}) {
  const services = new Map(Object.entries(initial))
  const listeners = new Map()
  const ctx = {
    get: (name) => services.get(name),
    provide: (name, value) => services.set(name, value),
    set: (name, value) => services.set(name, value),
    on: (event, listener) => {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(event, current.filter((item) => item !== listener))
      }
    },
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    effect: (callback) => callback(),
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, services, listeners }
}

export function createMemoryOwner() {  let held = false
  let token = 'token-1'
  return {
    ownerId: 'test-owner',
    get held() { return held },
    get fencingToken() { return held ? token : undefined },
    lockDir: '/tmp/fake-automation-owner',
    async acquire() { if (held) return false; held = true; token = `token-${Math.random().toString(36).slice(2)}`; return true },
    async renew() { return held },
    async release() { held = false },
    read: async () => undefined,
  }
}

export function schedulerHarness({ now = () => Date.parse('2026-10-27T00:31:00Z'), owner } = {}) {
  const domain = createFakeDomain()
  const dispatches = []
  const runner = {
    async dispatch(run, task, trigger) { dispatches.push({ run, task, trigger }) },
    cancelRun: () => false,
  }
  return { domain, dispatches, runner, now, owner }
}

export function httpFixture({ method = 'GET', url = '/', body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* iterate() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload ?? '' },
    json() { return JSON.parse(this.body) },
  }
  return { req, res }
}
