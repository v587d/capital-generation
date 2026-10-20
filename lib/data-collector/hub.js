/** Normalize an internal data_key token; data_key is host-only and never model-visible. */
export function normalizeKeyToken(value) {
    return value.replace(/[\\/:]+/g, '.')
        .replace(/[^A-Za-z0-9._-]+/g, '.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '');
}
export function buildDataKey(provider, kind, resource) {
    return [provider, kind, resource].map(normalizeKeyToken).filter(Boolean).join('.');
}
function summarize(source) {
    if (typeof source.summary === 'string' && source.summary.trim().length > 0)
        return source.summary.trim();
    const description = (source.description ?? '').trim();
    if (description.length === 0)
        return source.capability;
    const firstSentence = description.split(/[。；;.]/)[0]?.trim() ?? description;
    return firstSentence.length > 80 ? `${firstSentence.slice(0, 79)}…` : firstSentence;
}
/** Escape `|` and newlines: they delimit catalog lines, and one unescaped splits a capability in two. */
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
function inlineFieldText(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length === 0 ? undefined : text;
}
/** Recursion bound for field dictionaries; real contracts are at most 3 deep. */
const MAX_FIELD_DEPTH = 5;
function inspectField(node) {
    if (!isPlainRecord(node))
        return { label: 'json', nullable: false };
    const outerNote = inlineFieldText(node.description);
    if (Array.isArray(node.oneOf)) {
        const branches = node.oneOf.filter((branch) => !isPlainRecord(branch) || branch.type !== 'null');
        const nullable = branches.length !== node.oneOf.length;
        // Nullable unions carry their description on the outer node, not the null branch.
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
    // Fields with enum but no type: infer type and list values instead of calling them open-ended json.
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
 * Project output_schema into one line per field. Raw JSON Schema costs ~55 chars per column and
 * blows the per-capability budget; this is display-only, output_schema stays authoritative.
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
/** In-flight merge key: same capability + params + task share one execution. */
function mergeKey(request) {
    return `${request.capability}:${request.task_id ?? ''}:${stableSerialize(request.params)}`;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Preserve a stable error `code` when rewrapping upstream errors; callers read it directly. */
function errorWithCode(message, source) {
    const failure = new Error(message);
    if (source && typeof source === 'object' && typeof source.code === 'string') {
        ;
        failure.code = source.code;
    }
    return failure;
}
/**
 * FIFO executor: success is persisted immediately as an immutable Dataset and only a DatasetRef is
 * returned. In-flight queue is the only in-memory raw data; reuse comes from workspace manifests.
 */
export class DataCollectorHub {
    queue = [];
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
     * Enqueue and wait: reuse a valid manifest unless force_refresh; identical in-flight requests share
     * one execution. Params are normalized before merge key and digest.
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
                // Shared by every caller with this mergeKey, so it must not bind any caller's AbortSignal.
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
    normalizeRequest(request) {
        const source = this.sources.get(request.capability);
        if (!source?.normalizeParams)
            return request;
        return { ...request, params: source.normalizeParams(request.params) };
    }
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
    settleWaiter(item, waiter, outcome) {
        item.waiters.delete(waiter);
        if (waiter.onAbort && waiter.signal)
            waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (outcome.kind === 'ok')
            waiter.resolve(outcome.ref);
        else
            waiter.reject(outcome.error);
    }
    /** Catalog: capability, one-line summary, paginated only. Full schemas would be pruned; details come from describeCapability. */
    listCapabilities() {
        return [...this.sources.values()].map((source) => ({
            capability: source.schema.capability,
            summary: summarize(source.schema),
            paginated: source.schema.paginated === true,
        }));
    }
    capabilityNames() {
        return [...this.sources.keys()];
    }
    /** Model-visible catalog: one `capability|summary|paginated` line each; JSON costs about twice the tokens. */
    capabilityDirectory() {
        return this.listCapabilities()
            .map((entry) => `${encodeDirectoryField(entry.capability)}|${encodeDirectoryField(entry.summary)}|${entry.paginated ? 1 : 0}`)
            .join('\n');
    }
    /** Single capability contract; undefined for unknown names (the tool layer classifies it). */
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
            // Abort cooperative sources and release the FIFO worker even if a source ignores the signal.
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
/** Derive storage format and row count from the declared row shape; fall back to inference. */
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
