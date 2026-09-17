import { ChartError } from './errors.js';
import { DatasetStoreError, } from '../data-collector/store.js';
const CHART_SOURCE_TOKEN_PATTERN = /^cs_[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_CHART_SOURCE_TTL_MS = 15 * 60 * 1000;
const jsonObject = (properties = {}, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function defaultTokenId() {
    const cryptoLike = globalThis.crypto;
    const suffix = cryptoLike?.randomUUID
        ? cryptoLike.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `cs_${suffix}`;
}
function sessionOf(exec) {
    const session = exec.agent?.session;
    if (!session || typeof session.id !== 'string' || session.id.length === 0) {
        throw new ChartError('chart_source_invalid', 'the calling agent session was not provided');
    }
    return session;
}
function delegatedSession(exec) {
    const session = sessionOf(exec);
    if (typeof session.header?.parentSession !== 'string' || session.header.parentSession.length === 0) {
        throw new ChartError('chart_source_scope_mismatch', 'prepare_chart_source is restricted to delegated data agents');
    }
    return session;
}
function readTaskId(value, required) {
    if (value === undefined || value === null || value === '') {
        if (required)
            throw new ChartError('chart_source_invalid', 'task_id is required when using chart_source_ref');
        return undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
        throw new ChartError('chart_source_invalid', 'task_id must be a non-empty string of at most 256 characters');
    }
    return value.trim();
}
function readDatasetId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new ChartError('chart_source_invalid', 'dataset_id is invalid');
    }
    return value;
}
function readToken(value) {
    if (typeof value !== 'string' || !CHART_SOURCE_TOKEN_PATTERN.test(value)) {
        throw new ChartError('chart_source_invalid', 'chart_source_ref is invalid');
    }
    return value;
}
/**
 * Short-lived capability tokens for nested visualization children.
 *
 * The token captures the direct data-agent session rather than asking a nested
 * child to re-prove the Dataset's one-hop session scope. Possession of the
 * opaque token is the capability; it is never converted into a filesystem path.
 */
export class ChartSourceTokenStore {
    tokens = new Map();
    now;
    ttlMs;
    newToken;
    constructor(options = {}) {
        this.now = options.now ?? (() => Date.now());
        this.ttlMs = options.ttlMs ?? DEFAULT_CHART_SOURCE_TTL_MS;
        this.newToken = options.newToken ?? defaultTokenId;
        if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
            throw new Error('ChartSourceTokenStore ttlMs must be a positive safe integer');
        }
    }
    purgeExpired(now) {
        for (const [token, record] of this.tokens) {
            if (record.expires_at <= now)
                this.tokens.delete(token);
        }
    }
    async issue(input) {
        const datasetId = readDatasetId(input.dataset_id);
        const taskId = readTaskId(input.task_id, true);
        const inspection = await input.store.inspectDataset(datasetId, input.session, input.signal);
        if (!inspection.query_access.readable || !['array', 'envelope_item'].includes(inspection.query_access.shape)) {
            throw new ChartError('chart_source_invalid', `Dataset ${datasetId} cannot be used as a chart source (${inspection.query_access.reason ?? inspection.query_access.shape})`);
        }
        const now = this.now();
        this.purgeExpired(now);
        const token = this.newToken();
        if (!CHART_SOURCE_TOKEN_PATTERN.test(token)) {
            throw new ChartError('chart_source_invalid', 'generated chart_source_ref is invalid');
        }
        if (this.tokens.has(token))
            throw new ChartError('chart_source_invalid', 'generated chart_source_ref already exists');
        const expiresAt = Math.min(inspection.retention_until, now + this.ttlMs);
        const record = {
            chart_source_ref: token,
            dataset_id: inspection.dataset_id,
            task_id: taskId,
            expires_at: expiresAt,
            sourceSession: input.session,
            issued_at: now,
        };
        this.tokens.set(token, record);
        return {
            chart_source_ref: record.chart_source_ref,
            dataset_id: record.dataset_id,
            task_id: record.task_id,
            expires_at: record.expires_at,
        };
    }
    resolve(input) {
        const token = readToken(input.chart_source_ref);
        const now = input.now ?? this.now();
        this.purgeExpired(now);
        const record = this.tokens.get(token);
        if (!record)
            throw new ChartError('chart_source_expired', 'chart_source_ref is unknown or expired');
        const taskId = readTaskId(input.task_id, true);
        if (record.task_id !== null && record.task_id !== taskId) {
            throw new ChartError('chart_source_scope_mismatch', 'chart_source_ref does not belong to this task');
        }
        if (input.session !== undefined) {
            const caller = input.session;
            const source = record.sourceSession;
            const isSource = caller.id === source.id;
            const isDirectChild = caller.header?.parentSession === source.id;
            if (!isSource && !isDirectChild) {
                throw new ChartError('chart_source_scope_mismatch', 'chart_source_ref is not authorized for this session');
            }
            if (source.header?.cwd !== undefined && caller.header?.cwd !== undefined && source.header.cwd !== caller.header.cwd) {
                throw new ChartError('chart_source_scope_mismatch', 'chart_source_ref does not belong to this workspace');
            }
        }
        return record;
    }
    revoke(chartSourceRef) {
        return this.tokens.delete(chartSourceRef);
    }
    size() {
        this.purgeExpired(this.now());
        return this.tokens.size;
    }
}
const outputSchema = jsonObject({
    chart_source_ref: { type: 'string' },
    dataset_id: { type: 'string' },
    task_id: { type: 'string' },
    expires_at: { type: 'integer' },
}, ['chart_source_ref', 'dataset_id', 'task_id', 'expires_at']);
/** Register the delegated-child-only token issuer. */
export function registerChartSourceTool(ctx, options) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const definition = {
        name: 'prepare_chart_source',
        description: '为当前 delegated data agent 的指定 Dataset 签发短期 chart_source_ref，供 visualization_specialist 通过受控 render_chart 读取。' +
            '只返回 opaque token 和小型元数据，不返回原始数据、文件路径或数据行；必须提供 dataset_id，可选 task_id。',
        parameters: jsonObject({
            dataset_id: { type: 'string', description: '已授权的 DatasetRef dataset_id' },
            task_id: { type: 'string', description: '当前可视化任务标识；用于绑定 token，必填' },
        }, ['dataset_id', 'task_id']),
        output: { schema: outputSchema, render },
        async execute(args, exec) {
            try {
                const session = delegatedSession(exec);
                return await options.tokens.issue({
                    store: options.store,
                    session,
                    dataset_id: args.dataset_id,
                    task_id: args.task_id,
                    signal: exec.signal,
                });
            }
            catch (error) {
                if (error instanceof ChartError) {
                    const visible = new Error(JSON.stringify(error.toEnvelope()));
                    visible.name = error.name;
                    visible.code = error.code;
                    throw visible;
                }
                if (error instanceof DatasetStoreError) {
                    const visible = new Error(JSON.stringify({ error: 'chart_source_invalid', detail: error.message }));
                    visible.name = 'ChartError';
                    visible.code = 'chart_source_invalid';
                    throw visible;
                }
                throw error;
            }
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(prepare_chart_source)');
}
export function chartSourceTokenForRender(tokens, args, session) {
    const chartSourceRef = typeof args.chart_source_ref === 'string' && args.chart_source_ref.trim().length > 0
        ? args.chart_source_ref.trim()
        : undefined;
    if (chartSourceRef === undefined)
        return undefined;
    if (!tokens)
        throw new ChartError('chart_source_invalid', 'chart_source_ref is not available in this runtime');
    const record = tokens.resolve({
        chart_source_ref: chartSourceRef,
        task_id: typeof args.task_id === 'string' ? args.task_id : undefined,
        session,
    });
    return {
        dataset_id: record.dataset_id,
        task_id: record.task_id,
        sourceSession: record.sourceSession,
    };
}
