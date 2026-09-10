/**
 * 规范化内部 data_key 片段：斜杠/冒号等路径分隔符一律映射为点，其余非常规
 * 字符折叠为点、合并连续点、去掉首尾点。data_key 只是宿主内部路由/审计身份，
 * 不出现在模型可见协议、人设或工具输出中。
 */
export function normalizeKeyToken(value) {
    return value.replace(/[\\/:]+/g, '.')
        .replace(/[^A-Za-z0-9._-]+/g, '.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '');
}
/**
 * 生成内部 data_key：provider.kind.resource（例如
 * buildDataKey('fuyao', 'api', '/api/a-share/prices/snapshot')
 * => 'fuyao.api.api.a-share.prices.snapshot'）。
 */
export function buildDataKey(provider, kind, resource) {
    return [provider, kind, resource].map(normalizeKeyToken).filter(Boolean).join('.');
}
function stableSerialize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableSerialize).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}
function paramsDigest(request) {
    const serialized = stableSerialize(request.params);
    const processLike = globalThis.process;
    const createHash = processLike?.getBuiltinModule?.('node:crypto')?.createHash;
    if (createHash)
        return createHash('sha256').update(serialized).digest('hex');
    // DSH runs on Node, but keep a deterministic opaque fallback for minimal hosts/tests.
    let hash = 0xcbf29ce484222325n;
    for (const character of serialized) {
        hash ^= BigInt(character.codePointAt(0) ?? 0);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0').repeat(4);
}
/** in-flight 合并键：同一 capability+params+task 的并发请求共享同一次执行。 */
function mergeKey(request) {
    return `${request.capability}:${request.task_id ?? ''}:${stableSerialize(request.params)}`;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Phase 1 数据执行器：FIFO 串行执行外部数据源，成功后由宿主 store 立即
 * 原子落盘为不可变 Dataset，只回传 DatasetRef。
 *
 * 明确不做：长期 raw data 内存缓存、按 data_key 的查询、source_preference 路由。
 * 已验证 DatasetRef 的复用由 workspace manifest 提供，内存只保留 in-flight 队列。
 */
export class DataCollectorHub {
    queue = [];
    /** 正在执行的队列项（执行期间不在 queue 中，但仍参与合并与容量判断）。 */
    active = null;
    sources = new Map();
    cacheLookups = new Map();
    store;
    running = false;
    maxQueueLength;
    requestTimeoutMs;
    now;
    constructor(options) {
        if (!options.store)
            throw new Error('DataCollectorHub requires a dataset store');
        this.store = options.store;
        this.maxQueueLength = options.maxQueueLength ?? 50;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.now = options.now ?? (() => Date.now());
    }
    registerSource(source) {
        const capability = source.schema.capability;
        if (!capability)
            throw new Error('data source requires a capability');
        if (this.sources.has(capability))
            throw new Error(`data source capability already registered: ${capability}`);
        for (const other of this.sources.values()) {
            if (other.schema.data_key === source.schema.data_key)
                throw new Error(`data source data_key already registered: ${source.schema.data_key}`);
        }
        this.sources.set(capability, source);
        return () => { if (this.sources.get(capability) === source)
            this.sources.delete(capability); };
    }
    /**
     * 入队并阻塞等待完成：先按 capability+params_digest 查找当前 session 下仍有效的
     * manifest；force_refresh=true 或没有可复用 Dataset 时才进入数据源队列。相同的
     * in-flight 请求仍共享一次执行，成功后立即由宿主 store 原子落盘。
     */
    async request(request, options = {}) {
        if (!request.capability)
            throw new Error('capability is required');
        if (!request.session)
            throw new Error('a calling agent session is required');
        if (options.signal?.aborted)
            throw new Error('request aborted');
        const key = mergeKey(request);
        const existing = this.queue.find((item) => item.mergeKey === key) ?? (this.active && this.active.mergeKey === key ? this.active : undefined);
        if (existing)
            return this.awaitSettlement(existing, options.signal);
        if (request.force_refresh !== true && this.store.findLatest) {
            let lookup = this.cacheLookups.get(key);
            if (!lookup) {
                lookup = this.store.findLatest({
                    session: request.session,
                    capability: request.capability,
                    params_digest: paramsDigest(request),
                    signal: options.signal,
                });
                this.cacheLookups.set(key, lookup);
                void lookup.finally(() => {
                    if (this.cacheLookups.get(key) === lookup)
                        this.cacheLookups.delete(key);
                }).catch(() => { });
            }
            const reusable = await lookup;
            if (reusable)
                return reusable;
            const afterLookup = this.queue.find((item) => item.mergeKey === key) ?? (this.active && this.active.mergeKey === key ? this.active : undefined);
            if (afterLookup)
                return this.awaitSettlement(afterLookup, options.signal);
        }
        if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueueLength)
            throw new Error(`data request queue is full (max ${this.maxQueueLength})`);
        const item = { request, mergeKey: key, waiters: new Set() };
        this.queue.push(item);
        const pending = this.awaitSettlement(item, options.signal);
        void this.processNext();
        return pending;
    }
    /** 挂一个等待者并返回其结算承诺；signal 触发时摘除等待者并拒绝（不影响共享执行）。 */
    awaitSettlement(item, signal) {
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, signal };
            if (signal?.aborted) {
                reject(new Error('request aborted'));
                return;
            }
            if (signal) {
                waiter.onAbort = () => {
                    item.waiters.delete(waiter);
                    reject(new Error('request aborted'));
                };
                signal.addEventListener('abort', waiter.onAbort, { once: true });
            }
            item.waiters.add(waiter);
        });
    }
    /** 结算一个等待者：无论成败都摘除监听，防止重复结算。 */
    settleWaiter(item, waiter, outcome) {
        item.waiters.delete(waiter);
        if (waiter.onAbort && waiter.signal)
            waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (outcome.kind === 'ok')
            waiter.resolve(outcome.ref);
        else
            waiter.reject(outcome.error);
    }
    /**
     * 列出模型可见的能力目录：只含 capability、描述、参数/输出结构与分页能力，
     * 不含任何内部路由字段（name/source/data_key/source_label）。
     */
    listCapabilities() {
        return [...this.sources.values()].map((source) => ({
            capability: source.schema.capability,
            description: source.schema.description ?? '',
            input_schema: source.schema.input_schema,
            output_schema: source.schema.output_schema ?? null,
            paginated: source.schema.paginated === true,
        }));
    }
    async processNext() {
        if (this.running)
            return;
        const item = this.queue.shift();
        if (!item)
            return;
        this.running = true;
        this.active = item;
        let timedOut = false;
        try {
            const source = this.sources.get(item.request.capability);
            if (!source)
                throw new Error(`no data source is registered for capability ${item.request.capability}`);
            const controller = new AbortController();
            let timeout;
            const operation = source.execute(item.request, controller.signal);
            // Abort cooperative sources and also release the FIFO worker if a source
            // ignores the signal. Observe the underlying promise to avoid an
            // unhandled rejection after the timeout race has settled.
            void operation.catch(() => { });
            const timeoutPromise = new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(new Error('request timed out'));
                }, this.requestTimeoutMs);
            });
            try {
                const output = await Promise.race([operation, timeoutPromise]);
                if (timedOut)
                    throw new Error('request timed out');
                if (source.validateOutput && !source.validateOutput(output.data)) {
                    throw new Error(`data source ${source.schema.name} returned data incompatible with its output contract`);
                }
                const { format, rowCount } = shapeOf(output.data);
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
                });
                for (const waiter of [...item.waiters])
                    this.settleWaiter(item, waiter, { kind: 'ok', ref });
            }
            finally {
                if (timeout)
                    clearTimeout(timeout);
            }
        }
        catch (error) {
            const message = timedOut ? 'request timed out' : errorMessage(error);
            for (const waiter of [...item.waiters])
                this.settleWaiter(item, waiter, { kind: 'error', error: new Error(message) });
        }
        finally {
            this.running = false;
            this.active = null;
            void this.processNext();
        }
    }
}
/** 从 Fuyao 类 envelope 推导存储 format 与行数；其余结构按通用 JSON 处理。 */
function shapeOf(data) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const item = data.item;
        if (Array.isArray(item))
            return { format: 'json_rows', rowCount: item.length };
    }
    return { format: 'json', rowCount: null };
}
export function provideDataCollectorHub(ctx, options) {
    const hub = new DataCollectorHub(options);
    ctx.provide('dataCollectorHub', hub);
    return hub;
}
