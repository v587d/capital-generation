import type { Context } from '@deepseek-ai/cordis'

export interface DataRequest {
  data_key: string
  source_preference?: string[]
  params: Record<string, unknown>
  force_refresh?: boolean
  /** 请求归属的 Agent id；由工具层以 exec.agent.id 注入，不接受模型传参。 */
  requester_agent_id: string
  schema_hint?: object
}

export interface CacheEntry {
  data_key: string
  data: unknown
  schema: object | null
  source: string
  from_cache: boolean
  updated_at: number
  expires_at: number
}

export interface SchemaDescriptor {
  name: string
  source: string
  /**
   * 该数据源的规范 data_key（provider.kind.resource，斜杠/冒号已规范化为点，
   * 如 fuyao.api.api.a-share.prices.snapshot）。由数据源注册代码生成
   * （buildDataKey），模型不造句、不改写；缓存键/路由/回传引用都以它为准，
   * 全注册表内必须唯一。
   */
  data_key: string
  /** 该数据源缓存存活时长（ms）声明；缺省用 Hub 默认 TTL，不再按键名猜。 */
  ttl_ms?: number
  input_schema: object
  output_schema?: object
  description?: string
}

/**
 * 规范化 data_key 片段：斜杠/冒号等路径分隔符一律映射为点，其余非常规字符
 * 也折叠为点、合并连续点、去掉首尾点，保证任何平台都能直接当文件名用。
 */
export function normalizeKeyToken(value: string): string {
  return value.replace(/[\\/:]+/g, '.')
    .replace(/[^A-Za-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/**
 * 生成规范 data_key：provider.kind.resource（例如
 * buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot')
 * => 'fuyao.api.api.a-share.prices.snapshot'）。
 */
export function buildDataKey(provider: string, kind: string, resource: string): string {
  return [provider, kind, resource].map(normalizeKeyToken).filter(Boolean).join('.')
}

export interface DataSource {
  schema: SchemaDescriptor
  execute(request: DataRequest, signal: AbortSignal): Promise<{ data: unknown; schema?: object | null }>
  /** Optional source-specific output guard; false rejects the result before caching. */
  validateOutput?: (data: unknown) => boolean
}

export interface DataCollectorHubOptions {
  /** 队列最大长度；默认 50。 */
  maxQueueLength?: number
  /** 缓存最大条目数；默认 500。 */
  maxCacheEntries?: number
  /** 单请求执行超时；默认 30_000 ms。超时抛错（request timed out）。 */
  requestTimeoutMs?: number
  /** 默认 TTL 兜底；数据源可经 schema.ttl_ms 声明覆盖。 */
  defaultTtlMs?: number
  /** 按 data_key 返回 TTL 的兜底分类（仅当数据源未声明 ttl_ms 时生效）；默认 defaultTtlMs。 */
  ttlFor?: (dataKey: string) => number
  /** 时钟注入（测试用）；默认 Date.now。 */
  now?: () => number
}

/** 一个等待者：阻塞式 request() 的结算承诺。 */
type Waiter = {
  resolve: (entry: CacheEntry) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

type QueueItem = { request: DataRequest; cacheKey: string; waiters: Set<Waiter> }

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

function cacheKey(request: DataRequest): string {
  return `${request.data_key}:${stableSerialize(request.params)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DataCollectorHub {
  private readonly queue: QueueItem[] = []
  /** 正在执行的队列项（执行期间不留在 queue 中，但仍参与合并与容量判断）。 */
  private active: QueueItem | null = null
  private readonly cache = new Map<string, CacheEntry>()
  private readonly sources = new Map<string, DataSource>()
  private running = false
  private readonly maxQueueLength: number
  private readonly maxCacheEntries: number
  private readonly requestTimeoutMs: number
  private readonly defaultTtlMs: number
  private readonly ttlFor: (dataKey: string) => number
  private readonly now: () => number

  constructor(options: DataCollectorHubOptions = {}) {
    this.maxQueueLength = options.maxQueueLength ?? 50
    this.maxCacheEntries = options.maxCacheEntries ?? 500
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000
    this.ttlFor = options.ttlFor ?? (() => this.defaultTtlMs)
    this.now = options.now ?? (() => Date.now())
  }

  registerSource(source: DataSource): () => void {
    const name = source.schema.name
    if (this.sources.has(name)) throw new Error(`data source already registered: ${name}`)
    for (const other of this.sources.values()) {
      if (other.schema.data_key === source.schema.data_key) throw new Error(`data source data_key already registered: ${source.schema.data_key}`)
    }
    this.sources.set(name, source)
    return () => { if (this.sources.get(name) === source) this.sources.delete(name) }
  }

  /**
   * 入队并阻塞等待执行完成。缓存命中立即返回；相同 data_key + params 的
   * 并发请求合并为同一次执行，所有等待者共享同一结果。失败（无数据源/
   * 执行超时/数据源错误/输出不合规）时抛出 Error，由调用方如实回传。
   * 不存在 request_id 与状态查询：结果要么直接返回，要么报错。
   */
  async request(request: DataRequest, options: { signal?: AbortSignal } = {}): Promise<CacheEntry> {
    if (!request.data_key || !request.requester_agent_id) {
      throw new Error('data_key and requester_agent_id are required')
    }
    if (options.signal?.aborted) throw new Error('request aborted')
    this.cleanExpired()
    const key = cacheKey(request)
    if (!request.force_refresh) {
      const cached = this.cache.get(key)
      if (cached) return { ...cached, from_cache: true }
    }
    const existing = this.queue.find((item) => item.cacheKey === key) ?? (this.active && this.active.cacheKey === key ? this.active : undefined)
    if (existing) return this.awaitSettlement(existing, options.signal)
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueueLength) throw new Error(`data request queue is full (max ${this.maxQueueLength})`)
    const item: QueueItem = { request, cacheKey: key, waiters: new Set() }
    this.queue.push(item)
    const pending = this.awaitSettlement(item, options.signal)
    void this.processNext()
    return pending
  }

  /** 挂一个等待者并返回其结算承诺；signal 触发时摘除等待者并拒绝（不影响共享执行）。 */
  private awaitSettlement(item: QueueItem, signal?: AbortSignal): Promise<CacheEntry> {
    return new Promise<CacheEntry>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      if (signal && !signal.aborted) {
        waiter.onAbort = () => {
          item.waiters.delete(waiter)
          reject(new Error('request aborted'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      item.waiters.add(waiter)
    })
  }

  /** 结算一个等待者：无论成败都摘除监听，防止重复结算。 */
  private settleWaiter(item: QueueItem, waiter: Waiter, outcome: { kind: 'ok'; entry: CacheEntry } | { kind: 'error'; error: Error }): void {
    item.waiters.delete(waiter)
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort)
    if (outcome.kind === 'ok') waiter.resolve(outcome.entry)
    else waiter.reject(outcome.error)
  }

  /** 查询缓存中的最新数据；提供 params 时只返回该参数组合的缓存。 */
  getLatest(dataKey: string, params?: Record<string, unknown>): CacheEntry | null {
    this.cleanExpired()
    if (params) {
      const exact = this.cache.get(`${dataKey}:${stableSerialize(params)}`)
      return exact ? { ...exact, from_cache: true } : null
    }
    let latest: CacheEntry | null = null
    for (const entry of this.cache.values()) if (entry.data_key === dataKey && (!latest || entry.updated_at > latest.updated_at)) latest = entry
    return latest ? { ...latest, from_cache: true } : null
  }

  /** 列出当前可用数据源 schema（来自已挂载的 API/MCP/Skill）。 */
  listSchemas(): SchemaDescriptor[] { return [...this.sources.values()].map((source) => ({ ...source.schema })) }

  private async processNext(): Promise<void> {
    if (this.running) return
    const item = this.queue.shift()
    if (!item) return
    this.running = true
    this.active = item
    const startedAt = this.now()
    let timedOut = false
    try {
      const source = this.chooseSource(item.request)
      if (!source) throw new Error('no data source is available for this request')
      const controller = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const operation = source.execute(item.request, controller.signal)
      // Abort cooperative sources and also release the FIFO worker if a source
      // ignores the signal. Observe the underlying promise to avoid an
      // unhandled rejection after the timeout race has settled.
      void operation.catch(() => {})
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          controller.abort()
          reject(new Error('request timed out'))
        }, this.requestTimeoutMs)
      })
      try {
        const output = await Promise.race([operation, timeoutPromise])
        if (timedOut) throw new Error('request timed out')
        if (source.validateOutput && !source.validateOutput(output.data)) {
          throw new Error(`data source ${source.schema.name} returned data incompatible with its output contract`)
        }
        const finishedAt = this.now()
        const ttl = source.schema.ttl_ms ?? this.ttlFor(item.request.data_key)
        const entry: CacheEntry = {
          data_key: item.request.data_key,
          data: output.data,
          schema: output.schema ?? item.request.schema_hint ?? source.schema.output_schema ?? null,
          source: source.schema.name,
          from_cache: false,
          updated_at: finishedAt,
          expires_at: finishedAt + ttl,
        }
        this.cache.set(item.cacheKey, entry)
        this.evictIfNeeded()
        for (const waiter of [...item.waiters]) this.settleWaiter(item, waiter, { kind: 'ok', entry })
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    } catch (error) {
      const message = timedOut ? 'request timed out' : errorMessage(error)
      for (const waiter of [...item.waiters]) this.settleWaiter(item, waiter, { kind: 'error', error: new Error(message) })
    } finally {
      this.running = false
      this.active = null
      void this.processNext()
    }
  }

  /**
   * 路由：data_key 与数据源声明的规范身份证精确匹配；source_preference 只做
   * 过滤（具体 capability 名最优先，其次 provider 令牌如 fuyao.api/ths，'any'
   * 表示仅按 data_key 匹配）。匹配不到或候选不唯一（理论上不可能，注册时
   * 身份证唯一）直接失败，不静默选第一个。
   */
  private chooseSource(request: DataRequest): DataSource | undefined {
    const preferences = request.source_preference ?? []
    const orderedPreferences = preferences.length > 0 ? preferences : ['any']

    for (const preference of orderedPreferences) {
      // A concrete capability name is the strongest and most deterministic hint.
      const exact = this.sources.get(preference)
      if (exact) return exact

      const providerToken = this.providerTokenOf(preference)
      const candidates = [...this.sources.values()].filter((source) => {
        if (source.schema.data_key !== request.data_key) return false
        return providerToken === undefined || this.providerTokenOf(source.schema.data_key) === providerToken
      })
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1) throw new Error(`ambiguous data source for ${request.data_key} and preference ${preference}; specify source name`)
    }
    return undefined
  }

  /**
   * 数据源身份证的 provider 令牌 = 前两段（如 fuyao.api.api.a-share... => fuyao.api）。
   * 'ths' 为 fuyao.api 的兼容别名；'any' 不限定 provider。
   */
  private providerTokenOf(value: string): string | undefined {
    if (value === 'any') return undefined
    const normalized = value === 'ths' ? 'fuyao.api' : normalizeKeyToken(value)
    const parts = normalized.split('.')
    return parts.length >= 2 ? parts.slice(0, 2).join('.') : undefined
  }

  private cleanExpired(): void {
    const now = this.now()
    for (const [key, entry] of this.cache) if (entry.expires_at <= now) this.cache.delete(key)
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].updated_at - b[1].updated_at)[0]
      if (!oldest) return
      this.cache.delete(oldest[0])
    }
  }
}

export function provideDataCollectorHub(ctx: Context, options?: DataCollectorHubOptions): DataCollectorHub {
  const hub = new DataCollectorHub(options)
  ctx.provide('dataCollectorHub', hub)
  return hub
}

declare module '@deepseek-ai/cordis' { interface Context { dataCollectorHub: DataCollectorHub } }