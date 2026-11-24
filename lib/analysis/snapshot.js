/**
 * AnalysisSnapshot: freeze the references an analysis is allowed to use, once.
 *
 * The snapshot stores refs, digests and a host-staged copy of each authorized input. It never stores
 * raw rows in the model-visible half: `snapshot.json` is host-only, and the model receives an opaque
 * ref plus a coverage summary.
 */
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { MAX_PRESENTATION_ROWS } from '../data-collector/store.js';
import { SNAPSHOT_FILE, analysisDir, inputsDir, newAnalysisId, readJsonFile, snapshotRef, writeFiles } from './storage.js';
import { ANALYSIS_PROTOCOL, AnalysisError, } from './types.js';
import { EVIDENCE_ITEM_MAX_BYTES, EVIDENCE_MAX_ITEMS, SNAPSHOT_TTL_MS } from './schemas.js';
const DATASET_COLUMN_SAMPLE = 200;
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/** Deterministic JSON: key order must not change a fingerprint. */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
function inferType(values) {
    let sawNull = false;
    for (const value of values) {
        if (value === null || value === undefined) {
            sawNull = true;
            continue;
        }
        if (typeof value === 'number')
            return Number.isInteger(value) ? 'integer' : 'number';
        if (typeof value === 'string')
            return 'string';
        if (typeof value === 'boolean')
            return 'boolean';
        if (Array.isArray(value))
            return 'array';
        if (typeof value === 'object')
            return 'object';
        return sawNull ? 'mixed' : typeof value;
    }
    return 'null';
}
function columnsOf(rows) {
    const sample = rows.slice(0, DATASET_COLUMN_SAMPLE);
    const names = [];
    const seen = new Set();
    for (const row of sample) {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
            continue;
        for (const key of Object.keys(row)) {
            if (seen.has(key))
                continue;
            seen.add(key);
            names.push(key);
        }
    }
    return names.map((name) => {
        const values = sample.map((row) => (row !== null && typeof row === 'object' && !Array.isArray(row)
            ? row[name]
            : undefined));
        return {
            name,
            type: inferType(values),
            nullable: values.some((value) => value === null || value === undefined),
        };
    });
}
function timeAxisOf(ref) {
    const coverage = ref.time_coverage;
    if (coverage === undefined || coverage.column === null || coverage.format === 'none')
        return null;
    return { column: coverage.column, unit: coverage.format, tz: 'dataset' };
}
function evidenceHash(item) {
    return sha256(stableStringify({ source_id: item.source_id, title: item.title, excerpt: item.excerpt ?? null, url: item.url ?? null }));
}
function validateEvidence(evidence) {
    if (evidence.length > EVIDENCE_MAX_ITEMS) {
        throw new AnalysisError('analysis_snapshot_invalid', `evidence 最多 ${EVIDENCE_MAX_ITEMS} 条，收到 ${evidence.length} 条`);
    }
    for (const item of evidence) {
        const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
        if (bytes > EVIDENCE_ITEM_MAX_BYTES) {
            throw new AnalysisError('analysis_snapshot_invalid', `证据 ${item.source_id} 有 ${bytes} 字节，超过单条上限 ${EVIDENCE_ITEM_MAX_BYTES}；只放摘要，正文留给检索侧`);
        }
    }
}
/**
 * Create the snapshot and stage its inputs.
 *
 * Any ref that cannot be read fails the whole call and names the object: a snapshot that silently
 * drops an input is worse than no snapshot, because every downstream number looks sourced.
 */
export async function createSnapshot(options) {
    const { reader, writer, session, input } = options;
    const now = options.now ?? Date.now();
    const analysisId = newAnalysisId();
    const dir = analysisDir(analysisId);
    validateEvidence(input.evidence);
    const datasets = [];
    const datasetFiles = [];
    const retentionCandidates = [];
    for (const ref of input.dataset_refs) {
        const datasetId = typeof ref?.dataset_id === 'string' ? ref.dataset_id.trim() : '';
        if (datasetId === '')
            throw new AnalysisError('analysis_snapshot_invalid', 'dataset_refs 里有空 dataset_id');
        let staged;
        try {
            staged = await reader.readPresentationRows({
                session,
                dataset_id: datasetId,
                maxRows: MAX_PRESENTATION_ROWS,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
        }
        catch (error) {
            throw new AnalysisError('analysis_input_invalid', `Dataset ${datasetId} 无法作为分析输入：${error instanceof Error ? error.message : String(error)}`);
        }
        const rows = staged.rows;
        const view = {
            shape: 'rows',
            columns: columnsOf(rows),
            row_count: rows.length,
            rows,
            envelope: staged.envelope ?? null,
            time_axis: timeAxisOf(staged.ref),
            truncated: false,
            source: {
                dataset_id: staged.ref.dataset_id,
                captured_at: staged.ref.captured_at,
                params_digest: staged.ref.params_digest,
            },
        };
        datasets.push(view);
        retentionCandidates.push(staged.ref.retention_until);
        datasetFiles.push({ name: `${datasetId}.json`, content: JSON.stringify(view) });
    }
    const profiles = [];
    const profileFiles = [];
    for (const ref of input.profile_refs) {
        const profileId = typeof ref?.profile_id === 'string' ? ref.profile_id.trim() : '';
        if (profileId === '')
            throw new AnalysisError('analysis_snapshot_invalid', 'profile_refs 里有空 profile_id');
        let staged;
        try {
            staged = await reader.readProfile({ session, profile_id: profileId, ...(options.signal === undefined ? {} : { signal: options.signal }) });
        }
        catch (error) {
            throw new AnalysisError('analysis_input_invalid', `profile ${profileId} 无法作为分析输入：${error instanceof Error ? error.message : String(error)}`);
        }
        profiles.push({ ref: staged.ref });
        retentionCandidates.push(staged.ref.retention_until);
        profileFiles.push({ name: `${profileId}.json`, content: JSON.stringify({ ref: staged.ref, profile: staged.profile }) });
    }
    const evidence = [...input.evidence];
    const inputFingerprint = sha256(stableStringify({
        protocol: ANALYSIS_PROTOCOL,
        task_id: input.task_id,
        question: input.question,
        instrument: input.instrument ?? null,
        purpose: input.purpose,
        horizon: input.horizon ?? null,
        depth: input.depth,
        as_of: input.as_of,
        data_cutoff: input.data_cutoff ?? null,
        datasets: datasets.map((item) => item.source),
        profiles: profiles.map((item) => ({ profile_id: item.ref.profile_id, created_at: item.ref.created_at })),
        evidence: evidence.map((item) => ({ source_id: item.source_id, hash: evidenceHash(item) })),
        prior_analysis_refs: input.prior_analysis_refs,
        constraints: input.constraints,
    }));
    const earliestRetention = retentionCandidates.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...retentionCandidates);
    const expiresAt = Math.min(now + SNAPSHOT_TTL_MS, earliestRetention);
    // Absolute paths come from the store write itself: the worker needs a real directory, the model never sees one.
    const writtenDatasets = datasetFiles.length === 0
        ? undefined
        : await writeFiles(writer, session, inputsDir(analysisId, 'datasets'), datasetFiles, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            what: '暂存 Dataset 副本失败',
        });
    const writtenProfiles = profileFiles.length === 0
        ? undefined
        : await writeFiles(writer, session, inputsDir(analysisId, 'profiles'), profileFiles, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            what: '暂存 profile 副本失败',
        });
    if (evidence.length > 0) {
        await writeFiles(writer, session, inputsDir(analysisId, 'evidence'), evidence.map((item) => ({
            name: `${item.source_id}.json`,
            content: JSON.stringify(item),
        })), {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            what: '暂存证据副本失败',
        });
    }
    const datasetsAbs = writtenDatasets?.[0]?.absolutePath;
    const profilesAbs = writtenProfiles?.[0]?.absolutePath;
    // dirname, not string slicing: Windows paths use a backslash separator.
    const inputsAbsolute = datasetsAbs !== undefined
        ? dirname(datasetsAbs)
        : profilesAbs !== undefined
            ? dirname(profilesAbs)
            : undefined;
    const record = {
        analysis_id: analysisId,
        task_id: input.task_id,
        question: input.question,
        ...(input.instrument === undefined ? {} : { instrument: input.instrument }),
        purpose: input.purpose,
        ...(input.horizon === undefined ? {} : { horizon: input.horizon }),
        depth: input.depth,
        as_of: input.as_of,
        ...(input.data_cutoff === undefined ? {} : { data_cutoff: input.data_cutoff }),
        dataset_refs: datasets.map((item) => item.source),
        profile_refs: profiles.map((item) => ({ profile_id: item.ref.profile_id, created_at: item.ref.created_at })),
        evidence,
        prior_analysis_refs: [...input.prior_analysis_refs],
        constraints: input.constraints,
        input_fingerprint: inputFingerprint,
        created_at: now,
        expires_at: expiresAt,
        limitations: [],
        datasets,
        profiles,
        paths: { dir, inputs_dir: inputsAbsolute === undefined ? `${dir}/inputs` : dirname(inputsAbsolute) },
    };
    await writeFiles(writer, session, dir, [{ name: SNAPSHOT_FILE, content: JSON.stringify(record) }], {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        what: '写入 snapshot.json 失败',
    });
    return { record, ref: snapshotRef(analysisId) };
}
/** Load a snapshot by ref and fail loudly when it is missing or expired. */
export async function loadSnapshot(options) {
    const record = await readJsonFile(options.reader, options.session, `${analysisDir(options.analysisId)}/${SNAPSHOT_FILE}`, options.signal);
    if (record === undefined || record.analysis_id !== options.analysisId) {
        throw new AnalysisError('analysis_snapshot_invalid', `找不到分析快照 ${options.analysisId}（ref 可能已失效，或不属于本会话）`);
    }
    const now = options.now ?? Date.now();
    if (record.expires_at <= now) {
        throw new AnalysisError('analysis_snapshot_expired', `分析快照 ${options.analysisId} 已于 ${new Date(record.expires_at).toISOString()} 过期；重新建快照再跑`);
    }
    return record;
}
/** Coverage summary returned to the model: counts and ranges only, never rows. */
export function snapshotCoverage(record) {
    return {
        datasets: record.datasets.map((item) => ({
            dataset_id: item.source.dataset_id,
            row_count: item.row_count,
            columns: item.columns.length,
            time_axis: item.time_axis?.column ?? null,
        })),
        profiles: record.profiles.map((item) => ({ profile_id: item.ref.profile_id, dataset_id: item.ref.dataset_id })),
        evidence: record.evidence.length,
        as_of: record.as_of,
        data_cutoff: record.data_cutoff ?? null,
    };
}
