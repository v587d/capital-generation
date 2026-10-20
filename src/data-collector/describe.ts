import {
  DatasetStoreError,
  type DatasetInspection,
  type ProfileDatasetResult,
  type SessionLike,
  type WorkspaceDatasetStore,
} from './store.js'
import { DatasetQueryError, type QueryResult, type QuerySpec } from './query.js'
import { normalizeQueryDates, withIsoTimeColumns } from './query-time.js'
import {
  coerceQueryShape,
  isRecord,
  parseJsonContainer,
  readDatasetId,
  readOptionalColumnList,
  readOptionalString,
  readOptionalTaskId,
} from './args.js'

/**
 * `describe_dataset`: inspect + profile + optional query in one call per Dataset. A single size gate
 * (SAFE_RESULT_CHARS) returns a small retryable receipt instead of letting the pruner truncate.
 */

/** Cap below the preset's 8192 prune threshold: overflow is loud and retryable instead of silently clipped. */
export const SAFE_RESULT_CHARS = 7_000

/** Request-size cap, not a result-size cap. */
export const MAX_DESCRIBE_QUERIES = 8

export interface DescribeRequest {
  dataset_id: string
  task_id?: string
  time_column?: string
  primary_key?: string
  /** Restrict statistics/categories/schema to these columns; omitted means all. */
  columns_of_interest?: string[]
  queries: QuerySpec[]
}

export interface DescribeQueryOutcome {
  index: number
  result?: QueryResult
  error?: { code: string; detail: string }
}

export interface DescribeResult {
  status: 'ok'
  dataset_id: string
  task_id: string | null
  session_id: string
  artifact_ref: string
  format: string
  capability: string
  source_label: string
  row_count: number
  captured_at: number
  retention_until: number
  params_digest: string
  query_access: DatasetInspection['query_access']
  profile_id: string
  profile_ref: string
  columns: string[]
  quality: ProfileDatasetResult['quality']
  statistics?: ProfileDatasetResult['statistics']
  categories?: ProfileDatasetResult['categories']
  time_facts?: ProfileDatasetResult['time_facts']
  structure?: ProfileDatasetResult['structure']
  document?: ProfileDatasetResult['document']
  schema?: ProfileDatasetResult['schema']
  validation?: ProfileDatasetResult['validation']
  warnings: string[]
  queries: DescribeQueryOutcome[]
}

export interface DescribeTooLarge {
  status: 'too_large'
  dataset_id: string
  profile_ref: string
  shape: DatasetInspection['query_access']['shape']
  columns: string[]
  bytes: number
  /** Size attribution: codepoints of facts vs queries, so the hint can name the bigger side. */
  facts_bytes: number
  queries_bytes: number
  hint: string
}

export type DescribeOutput = DescribeResult | DescribeTooLarge

function errorEnvelope(error: unknown): { code: string; detail: string } {
  if (error instanceof DatasetQueryError || error instanceof DatasetStoreError) {
    const prefix = `${error.code}: `
    return { code: error.code, detail: error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message }
  }
  return { code: 'query_failed', detail: error instanceof Error ? error.message : String(error) }
}

/** Match the pruner: measure Unicode code points, not UTF-16 units. */
function codePointLength(text: string): number {
  return [...text].length
}

/**
 * Strip own properties whose value is `undefined`: DSH validates tool output as lossless JSON and
 * invalidates the whole call. JSON.stringify hides these, so local self-tests cannot catch them.
 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function normalizeQueryItem(value: unknown, index: number, datasetId: string): QuerySpec {
  if (!isRecord(value)) throw new DatasetQueryError('query_spec_invalid', `queries[${index}] must be an object`)
  let source: Record<string, unknown> = value
  if (value.query !== undefined) {
    const envelope = isRecord(value.query) ? value.query : parseJsonContainer(value.query)
    if (!isRecord(envelope)) throw new DatasetQueryError('query_spec_invalid', `queries[${index}].query must be an object`)
    source = envelope
  }
  if (source.dataset_id !== undefined && source.dataset_id !== datasetId) {
    throw new DatasetQueryError('query_spec_invalid', `queries[${index}].dataset_id must match the describe_dataset dataset_id`)
  }
  const shape = coerceQueryShape(source)
  // Envelope and message metadata are not QuerySpec; dataset_id is filled by the pipeline.
  for (const field of ['type', 'task_id', 'dataset_id']) delete shape[field]
  return shape as unknown as QuerySpec
}

/** Lenient boundary parsing, sharing primitives with query_dataset so both tools accept the same shapes. */
export function normalizeDescribeArgs(args: Record<string, unknown>): DescribeRequest {
  const dataset_id = readDatasetId(args.dataset_id)

  const rawQueries = args.queries
  let list: unknown[] = []
  if (rawQueries !== undefined && rawQueries !== null && rawQueries !== '') {
    const parsed = parseJsonContainer(rawQueries)
    if (Array.isArray(rawQueries)) list = rawQueries
    else if (Array.isArray(parsed)) list = parsed
    else if (isRecord(rawQueries)) list = [rawQueries]
    else if (isRecord(parsed)) list = [parsed]
    else throw new DatasetQueryError('query_spec_invalid', 'queries must be an array of QuerySpec objects (a JSON array string is also accepted)')
  }
  if (list.length > MAX_DESCRIBE_QUERIES) {
    throw new DatasetQueryError('query_spec_invalid', `queries must contain at most ${MAX_DESCRIBE_QUERIES} items`)
  }

  return {
    dataset_id,
    task_id: readOptionalTaskId(args.task_id),
    time_column: readOptionalString(args.time_column),
    primary_key: readOptionalString(args.primary_key),
    columns_of_interest: readOptionalColumnList(args.columns_of_interest),
    queries: list.map((item, index) => normalizeQueryItem(item, index, dataset_id)),
  }
}

function restrictFacts(
  profile: ProfileDatasetResult,
  columns: string[] | undefined,
  shape: DatasetInspection['query_access']['shape'],
  warnings: string[],
): Pick<DescribeResult, 'statistics' | 'categories' | 'schema'> & { keep?: Set<string> } {
  const facts = { statistics: profile.statistics, categories: profile.categories, schema: profile.schema }
  if (columns === undefined || columns.length === 0) return facts
  if (shape === 'document') {
    warnings.push('columns_of_interest has no effect on a document Dataset')
    return facts
  }
  const known = new Set(profile.columns)
  const unknown = columns.filter((column) => !known.has(column))
  if (unknown.length > 0) warnings.push(`columns_of_interest ignored unknown columns: ${unknown.join(', ')}`)
  const keep = new Set(columns.filter((column) => known.has(column)))
  const pick = <T>(map: Record<string, T> | undefined): Record<string, T> | undefined => map === undefined
    ? undefined
    : Object.fromEntries(Object.entries(map).filter(([column]) => keep.has(column)))
  return { statistics: pick(profile.statistics), categories: pick(profile.categories), schema: pick(profile.schema), keep }
}

/** Narrow first/last projections too; the time column always stays or the projection loses its coordinate. */
function restrictTimeFacts(
  facts: ProfileDatasetResult['time_facts'],
  keep: Set<string> | undefined,
): ProfileDatasetResult['time_facts'] {
  if (facts === undefined || keep === undefined) return facts
  const pick = (row: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
    Object.entries(row).filter(([column]) => column === facts.time_column || keep.has(column)),
  )
  return { ...facts, first: pick(facts.first), last: pick(facts.last) }
}

export interface DescribeDatasetInput {
  store: WorkspaceDatasetStore
  session: SessionLike
  request: DescribeRequest
  signal?: AbortSignal
}

/** Fail loudly on any error: a single-dataset call has no partial success. */
export async function describeDataset(input: DescribeDatasetInput): Promise<DescribeOutput> {
  const { store, session, request, signal } = input

  const inspection = await store.inspectDataset(request.dataset_id, session, signal)
  if (!inspection.query_access.readable) {
    const reason = inspection.query_access.reason
    const code = reason === 'dataset_too_large' ? 'dataset_too_large' : 'dataset_not_row_readable'
    throw new DatasetStoreError(code, `Dataset ${inspection.dataset_id} cannot be read for description (${reason ?? 'none'})`)
  }

  const profile = await store.profileDataset({
    session,
    dataset_id: inspection.dataset_id,
    task_id: request.task_id,
    time_column: request.time_column,
    primary_key: request.primary_key,
    signal,
  })

  const shape = inspection.query_access.shape
  const warnings = [...profile.warnings]
  const queries: DescribeQueryOutcome[] = []
  if (shape === 'document') {
    if (request.queries.length > 0) warnings.push('document Dataset has no row array; queries were not executed')
  } else {
    // Embedded queries must be isomorphic to query_dataset (same query-time normalization);
    // otherwise the same date string behaves differently in the same turn.
    const axisColumn = request.time_column ?? profile.time_facts?.time_column
    for (const [index, query] of request.queries.entries()) {
      try {
        const prepared = await normalizeQueryDates({
          store,
          session,
          dataset_id: inspection.dataset_id,
          query: { ...query, dataset_id: inspection.dataset_id },
          ...(axisColumn === undefined ? {} : { time_column: axisColumn }),
          signal,
        })
        const result = await store.queryDataset({
          session,
          dataset_id: inspection.dataset_id,
          query: prepared.query,
          signal,
        })
        if (prepared.axis !== undefined) withIsoTimeColumns(result as unknown as Record<string, unknown>, prepared.axis)
        queries.push({ index, result })
      } catch (error) {
        queries.push({ index, error: errorEnvelope(error) })
      }
    }
  }

  const facts = restrictFacts(profile, request.columns_of_interest, shape, warnings)

  // Assemble with undefined allowed, then compact once before returning (see compact).
  const value = compact({
    status: 'ok',
    // Deliberately omit DatasetRef.schema: it collides with profile.schema and doubles wide-table size.
    dataset_id: inspection.dataset_id,
    task_id: inspection.task_id,
    session_id: inspection.session_id,
    artifact_ref: inspection.artifact_ref,
    format: inspection.format,
    capability: inspection.capability,
    source_label: inspection.source_label,
    row_count: profile.row_count,
    captured_at: inspection.captured_at,
    retention_until: inspection.retention_until,
    params_digest: inspection.params_digest,
    query_access: inspection.query_access,
    profile_id: profile.profile_id,
    profile_ref: profile.artifact_ref,
    columns: profile.columns,
    quality: profile.quality,
    statistics: facts.statistics,
    categories: facts.categories,
    schema: facts.schema,
    time_facts: restrictTimeFacts(profile.time_facts, facts.keep),
    structure: profile.structure,
    document: profile.document,
    validation: profile.validation,
    warnings,
    queries,
  }) as unknown as DescribeResult

  const encoded = JSON.stringify(value)
  const bytes = codePointLength(encoded)
  if (bytes > SAFE_RESULT_CHARS) {
    // Attribution lets the hint name the big side without adding a second gate
    // (there is still exactly one size gate).
    const queriesBytes = codePointLength(JSON.stringify(value.queries))
    const factsBytes = bytes - queriesBytes
    return compact({
      status: 'too_large',
      dataset_id: inspection.dataset_id,
      profile_ref: profile.artifact_ref,
      shape,
      columns: profile.columns,
      bytes,
      facts_bytes: factsBytes,
      queries_bytes: queriesBytes,
      hint: shape === 'document'
        ? '文档型 Dataset 的结果超预算：直接调 profile_dataset 取有界内容（本工具的列过滤对文档无效）'
        : queriesBytes > factsBytes
          ? `结果超预算（queries 占 ${queriesBytes} > facts 占 ${factsBytes}）：先去掉 queries（只 describe 不带 queries，聚合改单独走 query_dataset），facts 仍超再用 columns_of_interest 收窄列`
          : `结果超预算（facts 占 ${factsBytes} ≥ queries 占 ${queriesBytes}）：先用 columns_of_interest 指定本次问题真正需要的列，或减少 queries 条数`,
    }) as unknown as DescribeTooLarge
  }
  return value
}
