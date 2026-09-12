import type { Context } from '@deepseek-ai/cordis'
import type { DatasetRef, SaveDatasetInput, SessionLike } from './store.js'

/**
 * 规范化内部 data_key 片段：斜杠/冒号等路径分隔符一律映射为点，其余非常规
 * 字符折叠为点、合并连续点、去掉首尾点。data_key 只是宿主内部路由/审计身份，
 * 不出现在模型可见协议、人设或工具输出中。
 */
export function normalizeKeyToken(value: string): string {
  return value.replace(/[\\/:]+/g, '.')
    .replace(/[^A-Za-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/**
 * 生成内部 data_key：provider.kind.resource（例如
 * buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot')
 * => 'fuyao.api.api.a-share.prices.snapshot'）。
 */
export function buildDataKey(provider: string, kind: string, resource: string): string {
  return [provider, kind, resource].map(normalizeKeyToken).filter(Boolean).join('.')
}

/**
 * 数据请求：capability 是模型可见的短能力名（全局唯一），session 由工具层以
 * exec.agent.session 注入，不接受模型传参。内部 data_key 不出现在请求协议里。
 */
export interface DataRequest {
  capability: string
  params: Record<string, unknown>
  /** force_refresh=true 绕过已验证 manifest 并生成新的不可变 Dataset。 */
  force_refresh?: boolean
  /** 本次用户任务关联 id（可复用）；只用于追溯，不要求模型理解。 */
  task_id?: string
  session: SessionLike
}

/**
 * 数据源契约：capability 为唯一注册键与模型可见名；name/source/data_key
 * 均为宿主内部字段（日志、路由、审计），不得进入工具 schema、输出或人设。
 */
export interface SchemaDescriptor {
  capability: string
  name: string
  source: string
  data_key: string
  source_label?: string
  paginated?: boolean
  /** 一行摘要：只用于能力目录（选能力够用），控制在 ~50 字以内。 */
  summary?: string
  /** 完整说明：只在 describe_capability 详情里返回（单位、null 语义、时间口径、分页口径）。 */
  description?: string
  input_schema: object
  output_schema?: object
}

/** 能力目录项：只带"选能力"所需的信息，体积必须远小于工具结果剪枝阈值。 */
export interface CapabilitySummary {
  capability: string
  summary: string
  paginated: boolean
}

/** 单个能力的完整契约：参数与输出结构，调用前必读。 */
export interface CapabilityDetail extends CapabilitySummary {
  description: string
  input_schema: object
  output_schema: object | null
}

/** 目录项摘要的兜底：描述缺失或没有 summary 时取首句并截断。 */
function summarize(source: SchemaDescriptor): string {
  if (typeof source.summary === 'string' && source.summary.trim().length > 0) return source.summary.trim()
  const description = (source.description ?? '').trim()
  if (description.length === 0) return source.capability
  const firstSentence = description.split(/[。；;.]/)[0]?.trim() ?? description
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 79)}…` : firstSentence
}

export interface DataSource {
  schema: SchemaDescriptor
  execute(request: DataRequest, signal: AbortSignal): Promise<{ data: unknown; schema?: object | null }>
  /** Optional source-specific output guard; false rejects the result before persistence. */
  validateOutput?: (data: unknown) => boolean
  /**
   * Optional parameter canonicalization. The Hub calls it BEFORE computing the
   * in-flight merge key and params_digest, so requests that differ only in
   * case/whitespace/list order/default values share one Dataset instead of
   * writing several. It must be idempotent (execute calls it again) and may
   * throw to reject invalid parameters before anything is queued. Sources that
   * omit it keep their previous behaviour exactly.
   */
  normalizeParams?: (params: Record<string, unknown>) => Record<string, unknown>
}

/** Dataset 落盘器（Hub 的唯一成功出口）。 */
export interface DatasetStoreLike {
  save(input: SaveDatasetInput): Promise<DatasetRef>
  /** Optional for compatibility with lightweight test stores; production store implements manifest lookup. */
  findLatest?(input: { session: SessionLike; capability: string; params_digest: string; signal?: AbortSignal }): Promise<DatasetRef | undefined>
}

export interface DataCollectorHubOptions {
  /** 必需：宿主侧 Dataset store；缺失时 request 直接失败。 */
  store: DatasetStoreLike
  /** 队列最大长度；默认 50。 */
  maxQueueLength?: number
  /** 传输层执行超时；默认 30_000 ms。只是请求超时，不是数据生命周期。 */
  requestTimeoutMs?: number
  /** 时钟注入（测试用）；默认 Date.now。 */
  now?: () => number
}

/** 一个等待者：阻塞式 request() 的结算承诺。 */
type Waiter = {
  resolve: (ref: DatasetRef) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

type QueueItem = { request: DataRequest; mergeKey: string; waiters: Set<Waiter> }

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

type HashLike = { update(value: string): HashLike; digest(encoding: string): string }

function paramsDigest(request: DataRequest): string {
  const serialized = stableSerialize(request.params)
  const processLike = (globalThis as { process?: { getBuiltinModule?: (name: string) => { createHash?: (algorithm: string) => HashLike } } }).process
  const createHash = processLike?.getBuiltinModule?.('node:crypto')?.createHash
  if (createHash) return createHash('sha256').update(serialized).digest('hex')

  // DSH runs on Node, but keep a deterministic opaque fallback for minimal hosts/tests.
  let hash = 0xcbf29ce484222325n
  for (const character of serialized) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0').repeat(4)
}

/** in-flight 合并键：同一 capability+params+task 的并发请求共享同一次执行。 */
function mergeKey(request: DataRequest): string {
  return `${request.capability}:${request.task_id ?? ''}:${stableSerialize(request.params)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把上游错误重新包装成 Error 时**保留稳定错误码**。
 *
 * DatasetStoreError 带 `code`（如 workspace_not_writable / dataset_expired），但此前一律被
 * 拍成纯文本 Error，调用方只能从消息前缀里猜。协议要求失败回传携带 `error` 与 `code`，
 * 因此这里把 code 原样挂到新 Error 上，工具层与上层消费者都可直接读取。
 */
function errorWithCode(message: string, source: unknown): Error {
  const failure = new Error(message)
  if (source && typeof source === 'object' && typeof (source as { code?: unknown }).code === 'string') {
    ;(failure as Error & { code?: string }).code = (source as { code: string }).code
  }
  return failure
}

/**
 * Phase 1 数据执行器：FIFO 串行执行外部数据源，成功后由宿主 store 立即
 * 原子落盘为不可变 Dataset，只回传 DatasetRef。
 *
 * 明确不做：长期 raw data 内存缓存、按 data_key 的查询、source_preference 路由。
 * 已验证 DatasetRef 的复用由 workspace manifest 提供，内存只保留 in-flight 队列。
 */
export class DataCollectorHub {
  private readonly queue: QueueItem[] = []
  /** 正在执行的队列项（执行期间不在 queue 中，但仍参与合并与容量判断）。 */
  private active: QueueItem | null = null
  private readonly sources = new Map<string, DataSource>()
  private readonly cacheLookups = new Map<string, Promise<DatasetRef | undefined>>()
  private readonly store: DatasetStoreLike
  private running = false
  private readonly maxQueueLength: number
  private readonly requestTimeoutMs: number
  private readonly now: () => number

  constructor(options: DataCollectorHubOptions) {
    if (!options.store) throw new Error('DataCollectorHub requires a dataset store')
    this.store = options.store
    this.maxQueueLength = options.maxQueueLength ?? 50
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.now = options.now ?? (() => Date.now())
  }

  registerSource(source: DataSource): () => void {
    const capability = source.schema.capability
    if (!capability) throw new Error('data source requires a capability')
    if (this.sources.has(capability)) throw new Error(`data source capability already registered: ${capability}`)
    for (const other of this.sources.values()) {
      if (other.schema.data_key === source.schema.data_key) throw new Error(`data source data_key already registered: ${source.schema.data_key}`)
    }
    this.sources.set(capability, source)
    return () => { if (this.sources.get(capability) === source) this.sources.delete(capability) }
  }

  /**
   * 入队并阻塞等待完成：先按 capability+params_digest 查找当前 session 下仍有效的
   * manifest；force_refresh=true 或没有可复用 Dataset 时才进入数据源队列。相同的
   * in-flight 请求仍共享一次执行，成功后立即由宿主 store 原子落盘。
   *
   * 参数规范化（source 可选）发生在这里：merge key 与 digest 都用规范化后的参数，
   * 因此「大小写/空白/重复项不同、语义相同」的请求命中同一个 Dataset。未知
   * capability 不做处理，仍由执行阶段抛出统一的 no data source 错误。
   */
  async request(request: DataRequest, options: { signal?: AbortSignal } = {}): Promise<DatasetRef> {
    if (!request.capability) throw new Error('capability is required')
    if (!request.session) throw new Error('a calling agent session is required')
    if (options.signal?.aborted) throw new Error('request aborted')
    const normalized = this.normalizeRequest(request)
    const key = mergeKey(normalized)
    const existing = this.queue.find((item) => item.mergeKey === key) ?? (this.active && this.active.mergeKey === key ? this.active : undefined)
    if (existing) return this.awaitSettlement(existing, options.signal)

    if (normalized.force_refresh !== true && this.store.findLatest) {
      let lookup = this.cacheLookups.get(key)
      if (!lookup) {
        // 这个 lookup 会被同一 mergeKey 的**所有**并发调用者共享，因此绝不能绑定
        // 其中任何一个人的 AbortSignal：首个调用者取消会让其余调用者一起收到同一个
        // lookup 失败，而不是各自独立等待。取消只作用于调用者自己的 waiter。
        lookup = this.store.findLatest({
          session: normalized.session,
          capability: normalized.capability,
          params_digest: paramsDigest(normalized),
        })
        this.cacheLookups.set(key, lookup)
        void lookup.finally(() => {
          if (this.cacheLookups.get(key) === lookup) this.cacheLookups.delete(key)
        }).catch(() => {})
      }
      const reusable = await lookup
      if (reusable) return reusable
      const afterLookup = this.queue.find((item) => item.mergeKey === key) ?? (this.active && this.active.mergeKey === key ? this.active : undefined)
      if (afterLookup) return this.awaitSettlement(afterLookup, options.signal)
    }

    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueueLength) throw new Error(`data request queue is full (max ${this.maxQueueLength})`)
    const item: QueueItem = { request: normalized, mergeKey: key, waiters: new Set() }
    this.queue.push(item)
    const pending = this.awaitSettlement(item, options.signal)
    void this.processNext()
    return pending
  }

  /** 应用 source 的可选参数规范化；未声明或 capability 未注册时原样返回。 */
  private normalizeRequest(request: DataRequest): DataRequest {
    const source = this.sources.get(request.capability)
    if (!source?.normalizeParams) return request
    return { ...request, params: source.normalizeParams(request.params) }
  }

  /** 挂一个等待者并返回其结算承诺；signal 触发时摘除等待者并拒绝（不影响共享执行）。 */
  private awaitSettlement(item: QueueItem, signal?: AbortSignal): Promise<DatasetRef> {
    return new Promise<DatasetRef>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      if (signal?.aborted) {
        reject(new Error('request aborted'))
        return
      }
      if (signal) {
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
  private settleWaiter(item: QueueItem, waiter: Waiter, outcome: { kind: 'ok'; ref: DatasetRef } | { kind: 'error'; error: Error }): void {
    item.waiters.delete(waiter)
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort)
    if (outcome.kind === 'ok') waiter.resolve(outcome.ref)
    else waiter.reject(outcome.error)
  }

  /**
   * 能力目录（模型可见的最外层发现入口）：只含 capability、一行摘要与是否分页。
   *
   * 目录刻意不带 input_schema / output_schema —— 全量 schema 一度达 23KB，
   * 会被工具结果剪枝器截掉中间部分，导致排在中间的能力在发现阶段不可见。
   * 目录必须一次性全部返回（体积预算由测试守住），详情走 describeCapability。
   * 不含任何内部路由字段（name/source/data_key/source_label）。
   */
  listCapabilities(): CapabilitySummary[] {
    return [...this.sources.values()].map((source) => ({
      capability: source.schema.capability,
      summary: summarize(source.schema),
      paginated: source.schema.paginated === true,
    }))
  }

  /** 当前已注册的能力名（用于未知名字的引导与诊断）。 */
  capabilityNames(): string[] {
    return [...this.sources.keys()]
  }

  /**
   * 单个能力的完整契约；名字未注册时返回 undefined，由工具层分类成可引导的错误。
   * 返回值只含模型可见字段，是新建的普通对象，不回传内部 live data。
   */
  describeCapability(capability: string): CapabilityDetail | undefined {
    const source = this.sources.get(capability)
    if (!source) return undefined
    return {
      capability: source.schema.capability,
      summary: summarize(source.schema),
      paginated: source.schema.paginated === true,
      description: source.schema.description ?? '',
      input_schema: source.schema.input_schema,
      output_schema: source.schema.output_schema ?? null,
    }
  }

  private async processNext(): Promise<void> {
    if (this.running) return
    const item = this.queue.shift()
    if (!item) return
    this.running = true
    this.active = item
    let timedOut = false
    try {
      const source = this.sources.get(item.request.capability)
      if (!source) throw new Error(`no data source is registered for capability ${item.request.capability}`)
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
        const { format, rowCount } = shapeOf(output.data)
        const ref = await this.store.save({
          session: item.request.session,
          capability: item.request.capability,
          task_id: item.request.task_id,
          params_digest: paramsDigest(item.request),
          source_label: source.schema.source_label ?? source.schema.source,
          format,
          schema: output.schema ?? source.schema.output_schema ?? null,
          row_count: rowCount,
          data: output.data,
        })
        for (const waiter of [...item.waiters]) this.settleWaiter(item, waiter, { kind: 'ok', ref })
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    } catch (error) {
      const message = timedOut ? 'request timed out' : errorMessage(error)
      const failure = errorWithCode(message, error)
      for (const waiter of [...item.waiters]) this.settleWaiter(item, waiter, { kind: 'error', error: failure })
    } finally {
      this.running = false
      this.active = null
      void this.processNext()
    }
  }
}

/** 从 Fuyao 类 envelope 推导存储 format 与行数；其余结构按通用 JSON 处理。 */
function shapeOf(data: unknown): { format: 'json' | 'json_rows'; rowCount: number | null } {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const item = (data as { item?: unknown }).item
    if (Array.isArray(item)) return { format: 'json_rows', rowCount: item.length }
  }
  return { format: 'json', rowCount: null }
}

export function provideDataCollectorHub(ctx: Context, options: DataCollectorHubOptions): DataCollectorHub {
  const hub = new DataCollectorHub(options)
  ctx.provide('dataCollectorHub', hub)
  return hub
}

declare module '@deepseek-ai/cordis' { interface Context { dataCollectorHub: DataCollectorHub } }
