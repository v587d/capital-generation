import { DatasetStoreError } from './store.js'

/**
 * Lenient parameter parsing at the Dataset tool boundary: models often send stringified JSON.
 * Shared by query_dataset and describe_dataset so both accept exactly the same shapes.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseJsonContainer(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0 || (text[0] !== '[' && text[0] !== '{')) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Accept a real array, a JSON array string, or a single column name. */
export function coerceNameList(value: unknown): unknown {
  if (Array.isArray(value)) return value
  const parsed = parseJsonContainer(value)
  if (Array.isArray(parsed)) return parsed
  if (typeof value === 'string' && parsed === undefined) {
    const text = value.trim()
    if (text.length > 0 && !text.startsWith('[') && !text.startsWith('{')) return [value]
  }
  return value
}

export function coerceObjectList(value: unknown): unknown {
  if (Array.isArray(value)) return value
  const parsed = parseJsonContainer(value)
  if (Array.isArray(parsed)) return parsed
  if (isRecord(parsed)) return [parsed]
  if (isRecord(value)) return [value]
  return value
}

export function coerceLimit(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  return /^\d+$/.test(text) ? Number(text) : value
}

export const QUERY_NAME_LIST_FIELDS = ['select', 'group_by'] as const
export const QUERY_OBJECT_LIST_FIELDS = ['filters', 'aggregates', 'order_by'] as const

/** Coerce QuerySpec array/object fields and limit to engine types; leave other fields untouched. */
export function coerceQueryShape(input: Record<string, unknown>): Record<string, unknown> {
  const shape: Record<string, unknown> = { ...input }
  for (const field of QUERY_NAME_LIST_FIELDS) if (field in shape) shape[field] = coerceNameList(shape[field])
  for (const field of QUERY_OBJECT_LIST_FIELDS) if (field in shape) shape[field] = coerceObjectList(shape[field])
  if ('limit' in shape) shape.limit = coerceLimit(shape.limit)
  return shape
}

/** Reject an invalid dataset_id at the tool boundary; never pass it to the store. */
export function readDatasetId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new DatasetStoreError('dataset_id_invalid', 'dataset_id is invalid')
  }
  return value
}

export function readOptionalTaskId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 256) {
    throw new DatasetStoreError('profile_invalid', 'task_id is invalid')
  }
  return value
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** columns_of_interest: accept array/JSON/single name; a wrong shape fails loudly rather than silently widening results. */
export function readOptionalColumnList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const coerced = coerceNameList(value)
  if (!Array.isArray(coerced) || coerced.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 128)) {
    throw new DatasetStoreError('profile_invalid', 'columns_of_interest must be an array of column names')
  }
  return [...new Set(coerced as string[])]
}
