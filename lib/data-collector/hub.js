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
/**
 * 目录字段的转义：`|` 与换行是行编码的分隔符，撞上去的后果是**一条能力被读成两条**
 * （错了不报错、只是话说错那一族），所以由生产者转义而不是指望摘要里恰好没有。
 */
function encodeDirectoryField(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r\n?/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}
function isPlainRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 说明段里不许有换行：一个字段变成两行会让字典的"一行一字段"承诺失效。 */
function inlineFieldText(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length === 0 ? undefined : text;
}
/** 字段字典的递归上界：真实契约最深 3 层，留余量，也不给畸形 schema 无限展开的机会。 */
const MAX_FIELD_DEPTH = 5;
function inspectField(node) {
    if (!isPlainRecord(node))
        return { label: 'json', nullable: false };
    const outerNote = inlineFieldText(node.description);
    if (Array.isArray(node.oneOf)) {
        const branches = node.oneOf.filter((branch) => !isPlainRecord(branch) || branch.type !== 'null');
        const nullable = branches.length !== node.oneOf.length;
        // 可空字段的说明写在联合的外侧（{ oneOf: [...], description }），内侧分支的说明作兜底。
        const note = outerNote === undefined ? undefined : { description: outerNote };
        if (branches.length === 1)
            return { ...inspectField(branches[0]), nullable, ...(note ?? {}) };
        return { label: branches.map((branch) => inspectField(branch).label).join('/') || 'json', nullable, ...(note ?? {}) };
    }
    const description = outerNote;
    const properties = isPlainRecord(node.properties) ? node.properties : undefined;
    if (node.type === 'array' || (node.type === undefined && node.items !== undefined)) {
        const items = isPlainRecord(node.items) ? node.items : undefined;
        const itemProperties = items === undefined ? undefined : (isPlainRecord(items.properties) ? items.properties : undefined);
        return {
            label: 'array',
            nullable: false,
            ...(itemProperties === undefined ? {} : { nested: itemProperties, nestedArray: true }),
            ...(description === undefined ? {} : { description }),
        };
    }
    if (properties !== undefined) {
        return { label: typeof node.type === 'string' ? node.type : 'object', nullable: false, nested: properties, ...(description === undefined ? {} : { description }) };
    }
    // 只有 `enum` 没写 `type` 的字段（龙虎榜渠道、板块类型这类）：按取值推断类型，并把取值列进说明段。
    // 标成 `json` 是话说错——模型会以为取值开放，于是写出目录里不存在的值。
    if (typeof node.type !== 'string' && Array.isArray(node.enum) && node.enum.length > 0) {
        const kinds = new Set(node.enum.map((value) => (typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value)));
        const values = node.enum.join('/');
        const note = description ?? (values.length <= 120 ? `取值 ${values}` : undefined);
        return { label: kinds.size === 1 ? String([...kinds][0]) : 'string', nullable: false, ...(note === undefined ? {} : { description: note }) };
    }
    return { label: typeof node.type === 'string' ? node.type : 'json', nullable: false, ...(description === undefined ? {} : { description }) };
}
function emitFields(properties, prefix, lines, depth) {
    for (const [name, definition] of Object.entries(properties)) {
        const shape = inspectField(definition);
        const nullable = shape.nullable ? '?' : '';
        const note = shape.description === undefined ? '' : `:${shape.description}`;
        lines.push(`${prefix}${name}:${shape.label}${nullable}${note}`);
        if (shape.nested === undefined || depth >= MAX_FIELD_DEPTH)
            continue;
        emitFields(shape.nested, `${prefix}${name}${shape.nestedArray ? '[].' : '.'}`, lines, depth + 1);
    }
}
/**
 * 把声明好的 `output_schema` 投影成字段字典：一行一个字段 `路径:类型[:说明]`，
 * 类型后缀 `?` 表示可为 null，`[].` 表示数组元素的字段，取值受限时说明段给出 `取值 a/b`。
 *
 * 为什么不直接把 JSON Schema 交给模型（实测）：详情体积几乎就等于 `output_schema` 体积，
 * 而它按每列 ~55 字符随**列数**线性增长——72 列的可转债档案光 schema 就 4699 字符，第一次
 * 注册就打穿单能力 4096 的预算。字典把每列压到 ~15 字符，列数不再卡住补录。
 * 权威声明仍住 `output_schema`：护栏与返回值契约照旧按 schema 校验，这里只是给模型看的投影，
 * 不是第二份真相。
 */
function renderOutputFields(schema) {
    if (!isPlainRecord(schema))
        return null;
    const shape = inspectField(schema);
    if (shape.nested === undefined)
        return null;
    const lines = [];
    emitFields(shape.nested, shape.nestedArray === true ? '[].' : '', lines, 1);
    return lines.length === 0 ? null : lines.join('\n');
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
        if (source.schema.cacheMaxAgeMs !== undefined && (!Number.isSafeInteger(source.schema.cacheMaxAgeMs) || source.schema.cacheMaxAgeMs <= 0)) {
            throw new Error(`data source ${capability} cacheMaxAgeMs must be a positive safe integer`);
        }
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
            const maxAge = this.sources.get(normalized.capability)?.schema.cacheMaxAgeMs;
            const age = reusable ? this.now() - reusable.captured_at : 0;
            if (reusable && (maxAge === undefined || (age >= 0 && age < maxAge)))
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
     * 能力目录的模型可见形态：一行一条 `capability|summary|paginated`（1=分页、0=不分页）。
     * 同等信息量下 JSON 数组要 5530 字符（69 条实测，其中 58% 是键名与标点），行编码 2435、
     * 均摊从 80 降到 35 字符——目录余量从 +7 条变成 +105 条。信息量没变、依然一次性全量返回，
     * §1.1 那条"不分页、不裁剪"的硬约束原样成立。结构化形态仍由 listCapabilities 提供（测试与内部消费）。
     */
    capabilityDirectory() {
        return this.listCapabilities()
            .map((entry) => `${encodeDirectoryField(entry.capability)}|${encodeDirectoryField(entry.summary)}|${entry.paginated ? 1 : 0}`)
            .join('\n');
    }
    /**
     * 单个能力的完整契约；名字未注册时返回 undefined，由工具层分类成可引导的错误。
     * 返回值只含模型可见字段，是新建的普通对象，不回传内部 live data。
     * `output_fields` 是 `output_schema` 的投影：详情体积按列数增长会被宽表打穿，见 renderOutputFields。
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
            output_fields: renderOutputFields(source.schema.output_schema),
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
                const { format, rowCount, rowKey } = shapeOf(output.data, source.schema.rowShape);
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
                    row_key: rowKey,
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
/**
 * 从数据源声明的行形状推导存储 format 与行数；未声明时退化为形状推断。
 *
 * 之前只认 `data.item`，于是龙虎榜（行数组在 `stock_items`）被整份判成
 * `format: 'json'`，data_junior 连 inspect 都说不可读。行在哪里是数据源的
 * 契约知识，不该由存储层猜。
 */
function shapeOf(data, hint) {
    if (Array.isArray(data))
        return { format: 'json_rows', rowCount: data.length };
    const keys = hint?.rowKeys ?? [hint?.rowKey ?? 'item'];
    let emptyKey;
    for (const key of keys) {
        const candidate = rowsAtPath(data, key);
        if (candidate === undefined)
            continue;
        if (candidate.length > 0)
            return { format: 'json_rows', rowCount: candidate.length, rowKey: key };
        emptyKey ??= key;
    }
    if (emptyKey !== undefined)
        return { format: 'json_rows', rowCount: 0, rowKey: emptyKey };
    return { format: 'json', rowCount: null };
}
function rowsAtPath(value, path) {
    const segments = path.split('.').filter(Boolean);
    const visit = (current, index) => {
        if (index === segments.length)
            return Array.isArray(current) ? current : undefined;
        if (!current || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        const segment = segments[index];
        if (segment.endsWith('[]')) {
            const child = current[segment.slice(0, -2)];
            if (!Array.isArray(child))
                return undefined;
            const merged = [];
            for (const item of child) {
                const rows = visit(item, index + 1);
                if (rows === undefined)
                    return undefined;
                merged.push(...rows);
            }
            return merged;
        }
        return visit(current[segment], index + 1);
    };
    return visit(value, 0);
}
export function provideDataCollectorHub(ctx, options) {
    const hub = new DataCollectorHub(options);
    ctx.provide('dataCollectorHub', hub);
    return hub;
}
