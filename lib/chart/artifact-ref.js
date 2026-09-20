import { ChartError } from './errors.js';
const CHART_REF_PATTERN = /^chart_[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_CHART_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
function defaultChartRef() {
    const cryptoLike = globalThis.crypto;
    const suffix = cryptoLike?.randomUUID
        ? cryptoLike.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `chart_${suffix}`;
}
/** Dataset/profile 的一跳 scope 规则；token 让 nested child 复用这个 owner scope。 */
export function chartSessionScopeId(session) {
    const parent = session.header?.parentSession;
    return typeof parent === 'string' && parent.length > 0 ? parent : session.id;
}
/**
 * In-process registry for chart_ref capabilities.
 *
 * The chart files live in the workspace, while this registry keeps the
 * session/task binding that makes a chart safe to present to its own session
 * (and to derive the `deliverables/presented` owner scope).
 * Process restart invalidates chart_ref capabilities; chart.html remains the
 * explicit offline fallback.
 */
export class ChartArtifactRegistry {
    records = new Map();
    now;
    retentionMs;
    newRef;
    constructor(options = {}) {
        this.now = options.now ?? (() => Date.now());
        this.retentionMs = options.retentionMs ?? DEFAULT_CHART_ARTIFACT_RETENTION_MS;
        this.newRef = options.newRef ?? defaultChartRef;
        if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs <= 0) {
            throw new Error('ChartArtifactRegistry retentionMs must be a positive safe integer');
        }
    }
    purgeExpired(now) {
        for (const [chartRef, record] of this.records) {
            if (record.expires_at <= now)
                this.records.delete(chartRef);
        }
    }
    issue(input) {
        const now = input.created_at ?? this.now();
        this.purgeExpired(now);
        const chartRef = this.newRef();
        if (!CHART_REF_PATTERN.test(chartRef) || this.records.has(chartRef)) {
            throw new ChartError('chart_ref_invalid', 'generated chart_ref is invalid or already exists');
        }
        const expiresAt = Math.min(input.expires_at ?? now + this.retentionMs, now + this.retentionMs);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
            throw new ChartError('chart_ref_invalid', 'chart artifact expiration is invalid');
        }
        const record = {
            chart_ref: chartRef,
            chart_id: input.chart_id,
            task_id: input.task_id ?? null,
            dataset_id: input.dataset_id ?? null,
            source_label: input.source_label ?? null,
            captured_at: input.captured_at ?? null,
            kind: input.kind,
            axis: input.axis,
            chart_url: input.chart_url,
            spec_path: input.spec_path,
            series_path: input.series_path,
            html_path: input.html_path,
            created_at: now,
            expires_at: expiresAt,
            owner_scope_id: chartSessionScopeId(input.session),
            owner_cwd: input.session.header?.cwd ?? null,
        };
        this.records.set(chartRef, record);
        return this.publicRecord(record);
    }
    resolve(input) {
        if (typeof input.chart_ref !== 'string' || !CHART_REF_PATTERN.test(input.chart_ref)) {
            throw new ChartError('chart_ref_invalid', 'chart_ref is invalid');
        }
        const now = this.now();
        this.purgeExpired(now);
        const record = this.records.get(input.chart_ref);
        if (!record)
            throw new ChartError('chart_ref_invalid', 'chart_ref is unknown or expired');
        if (record.owner_scope_id !== chartSessionScopeId(input.session)) {
            throw new ChartError('chart_ref_scope_mismatch', 'chart_ref does not belong to the current session scope');
        }
        if (record.owner_cwd !== (input.session.header?.cwd ?? null)) {
            throw new ChartError('chart_ref_scope_mismatch', 'chart_ref does not belong to the current workspace');
        }
        if (input.task_id !== undefined && input.task_id !== null && record.task_id !== input.task_id) {
            throw new ChartError('chart_ref_task_mismatch', 'chart_ref does not belong to the current task');
        }
        return this.publicRecord(record);
    }
    revoke(chartRef) {
        return this.records.delete(chartRef);
    }
    size() {
        this.purgeExpired(this.now());
        return this.records.size;
    }
    publicRecord(record) {
        const { owner_scope_id: _ownerScope, ...publicRecord } = record;
        return publicRecord;
    }
}
