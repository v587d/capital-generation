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
/** 目录项摘要的兜底：描述缺失或没有 summary 时取首句并截断。 */
function summarize(source) {
    if (typeof source.summary === 'string' && source.summary.trim().length > 0)
        return source.summary.trim();
    const description = (source.description ?? '').trim();
    if (description.length === 0)
        return source.capability;
    const firstSentence = description.split(/[。；;.]/)[0]?.trim() ?? description;
    return firstSentence.length > 80 ? `${firstSentence.slice(0, 79)}…` : firstSentence;
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
 * 把上游错误重新包装成 Error 时**保留稳定错误码**。
 *
 * DatasetStoreError 带 `code`（如 workspace_not_writable / dataset_expired），但此前一律被
 * 拍成纯文本 Error，调用方只能从消息前缀里猜。协议要求失败回传携带 `error` 与 `code`，
 * 因此这里把 code 原样挂到新 Error 上，工具层与上层消费者都可直接读取。
 */
function errorWithCode(message, source) {
    const failure = new Error(message);
    if (source && typeof source === 'object' && typeof source.code === 'string') {
        ;
        failure.code = source.code;
    }
    return failure;
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
     *
     * 参数规范化（source 可选）发生在这里：merge key 与 digest 都用规范化后的参数，
     * 因此「大小写/空白/重复项不同、语义相同」的请求命中同一个 Dataset。未知
     * capability 不做处理，仍由执行阶段抛出统一的 no data source 错误。
     */
    async request(request, options = {}) {
        if (!request.capability)
            throw new Error('capability is required');
        if (!request.session)
            throw new Error('a calling agent session is required');
        if (options.signal?.aborted)
            throw new Error('request aborted');
        const normalized = this.normalizeRequest(request);
        const key = mergeKey(normalized);
        const existing = this.queue.find((item) => item.mergeKey === key) ?? (this.active && this.active.mergeKey === key ? this.active : undefined);
        if (existing)
            return this.awaitSettlement(existing, options.signal);
        if (normalized.force_refresh !== true && this.store.findLatest) {
            let lookup = this.cacheLookups.get(key);
            if (!lookup) {
                // 这个 lookup 会被同一 mergeKey 的**所有**并发调用者共享，因此绝不能绑定
                // 其中任何一个人的 AbortSignal：首个调用者取消会让其余调用者一起收到同一个
                // lookup 失败，而不是各自独立等待。取消只作用于调用者自己的 waiter。
                lookup = this.store.findLatest({
                    session: normalized.session,
                    capability: normalized.capability,
                    params_digest: paramsDigest(normalized),
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
        const item = { request: normalized, mergeKey: key, waiters: new Set() };
        this.queue.push(item);
        const pending = this.awaitSettlement(item, options.signal);
        void this.processNext();
        return pending;
    }
    /** 应用 source 的可选参数规范化；未声明或 capability 未注册时原样返回。 */
    normalizeRequest(request) {
        const source = this.sources.get(request.capability);
        if (!source?.normalizeParams)
            return request;
        return { ...request, params: source.normalizeParams(request.params) };
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
     * 能力目录（模型可见的最外层发现入口）：只含 capability、一行摘要与是否分页。
     *
     * 目录刻意不带 input_schema / output_schema —— 全量 schema 一度达 23KB，
     * 会被工具结果剪枝器截掉中间部分，导致排在中间的能力在发现阶段不可见。
     * 目录必须一次性全部返回（体积预算由测试守住），详情走 describeCapability。
     * 不含任何内部路由字段（name/source/data_key/source_label）。
     */
    listCapabilities() {
        return [...this.sources.values()].map((source) => ({
            capability: source.schema.capability,
            summary: summarize(source.schema),
            paginated: source.schema.paginated === true,
        }));
    }
    /** 当前已注册的能力名（用于未知名字的引导与诊断）。 */
    capabilityNames() {
        return [...this.sources.keys()];
    }
    /**
     * 单个能力的完整契约；名字未注册时返回 undefined，由工具层分类成可引导的错误。
     * 返回值只含模型可见字段，是新建的普通对象，不回传内部 live data。
     */
    describeCapability(capability) {
        const source = this.sources.get(capability);
        if (!source)
            return undefined;
        return {
            capability: source.schema.capability,
            summary: summarize(source.schema),
            paginated: source.schema.paginated === true,
            description: source.schema.description ?? '',
            input_schema: source.schema.input_schema,
            output_schema: source.schema.output_schema ?? null,
        };
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
            const failure = errorWithCode(message, error);
            for (const waiter of [...item.waiters])
                this.settleWaiter(item, waiter, { kind: 'error', error: failure });
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
