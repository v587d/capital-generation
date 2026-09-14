export const MAX_QUERY_FILTERS = 32
export const MAX_QUERY_GROUP_BY = 16
export const MAX_QUERY_AGGREGATES = 16
export const MAX_QUERY_SELECT = 32
export const MAX_QUERY_ORDER_BY = 16
export const MAX_QUERY_LIMIT = 200
export const DEFAULT_QUERY_LIMIT = 100
export const MAX_QUERY_GROUPS = 1_000
export const MAX_QUERY_OUTPUT_BYTES = 256 * 1024
export const MAX_QUERY_SPEC_BYTES = 64 * 1024

export type QueryErrorPolicy = 'strict' | 'skip_with_warning'

export type QueryOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'is_null' | 'not_null'
export type QueryAggregateFunction = 'count' | 'min' | 'max' | 'avg' | 'sum'
export type QueryOrderDirection = 'asc' | 'desc'

export interface QueryFilter {
  column: string
  operator: QueryOperator
  value?: unknown
}

export interface QueryAggregate {
  function: QueryAggregateFunction
  column?: string
  as: string
}

export interface QueryOrderBy {
  column: string
  direction: QueryOrderDirection
}

export interface QuerySpec {
  dataset_id: string
  select?: string[]
  filters?: QueryFilter[]
  group_by?: string[]
  aggregates?: QueryAggregate[]
  order_by?: QueryOrderBy[]
  limit?: number
  error_policy?: QueryErrorPolicy
}

export interface QueryResult {
  dataset_id: string
  columns: string[]
  rows: Array<Record<string, unknown>>
  matched_row_count: number
  group_count: number
  returned_count: number
  limit: number
  warnings: string[]
}

export type QueryErrorCode =
  | 'query_spec_invalid'
  | 'query_column_not_found'
  | 'query_type_conflict'
  | 'query_group_limit_exceeded'
  | 'query_result_too_large'
  | 'query_rows_invalid'

export class DatasetQueryError extends Error {
  readonly code: QueryErrorCode

  constructor(code: QueryErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'DatasetQueryError'
    this.code = code
  }
}

type ContractType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'json'
type Contract = { type: ContractType; allowNumericString: boolean }
type Cell = { present: boolean; value: unknown }
type GroupState = {
  values: Record<string, unknown>
  rows: unknown[]
}

type EffectiveSchema = Record<string, Contract>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(code: QueryErrorCode, detail: string): never {
  throw new DatasetQueryError(code, detail)
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function rowCell(row: unknown, column: string): Cell {
  if (isRecord(row)) return { present: own(row, column), value: row[column] }
  if (column === 'value') return { present: true, value: row }
  return { present: false, value: undefined }
}

function profileContractType(schema: unknown): ContractType | undefined {
  if (!isRecord(schema)) return undefined
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number') return 'number'
  if (schema.type === 'integer') return 'integer'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'object') return 'object'
  if (schema.type === 'array') return 'array'
  if (Array.isArray(schema.oneOf)) {
    for (const option of schema.oneOf) {
      const type = profileContractType(option)
      if (type) return type
    }
  }
  return 'json'
}

function extractContracts(schema: unknown): EffectiveSchema {
  if (!isRecord(schema)) return {}
  let rowSchema: unknown = schema
  const rootProperties = isRecord(schema.properties) ? schema.properties : undefined
  const itemSchema = rootProperties && isRecord(rootProperties.item) ? rootProperties.item : undefined
  if (itemSchema) rowSchema = itemSchema
  if (isRecord(rowSchema) && rowSchema.type === 'array' && rowSchema.items !== undefined) rowSchema = rowSchema.items
  const properties = isRecord(rowSchema) && isRecord(rowSchema.properties) ? rowSchema.properties : undefined
  if (!properties) return {}
  const contracts: EffectiveSchema = {}
  for (const [column, property] of Object.entries(properties)) {
    const type = profileContractType(property)
    if (type) contracts[column] = { type, allowNumericString: type === 'number' || type === 'integer' }
  }
  return contracts
}

function observedType(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

function numericString(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function numericValue(value: unknown, contract: Contract | undefined): number | undefined {
  const number = typeof value === 'number' && Number.isFinite(value)
    ? value
    : contract?.allowNumericString
      ? numericString(value)
      : undefined
  if (number === undefined) return undefined
  if (contract?.type === 'integer' && !Number.isSafeInteger(number)) return undefined
  return number
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`
}

function sameType(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)) return true
  return typeof left === typeof right && (left === null) === (right === null)
}

function isNullish(cell: Cell): boolean {
  return !cell.present || cell.value === null || cell.value === undefined
}

function assertJsonSerializable(value: unknown, detail: string): void {
  try {
    if (JSON.stringify(value) === undefined) fail('query_spec_invalid', detail)
  } catch {
    fail('query_spec_invalid', detail)
  }
}

function assertUniqueNames(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail('query_spec_invalid', `${label} must contain unique names`)
}

function validateSpec(input: unknown): QuerySpec {
  if (!isRecord(input)) fail('query_spec_invalid', 'query must be an object')
  const allowed = new Set(['dataset_id', 'select', 'filters', 'group_by', 'aggregates', 'order_by', 'limit', 'error_policy'])
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('query_spec_invalid', 'query contains unsupported fields')
  if (!validName(input.dataset_id)) fail('query_spec_invalid', 'dataset_id must be a non-empty string of at most 128 characters')

  const selectInput = input.select
  if (selectInput !== undefined && (!Array.isArray(selectInput) || selectInput.length < 1 || selectInput.length > MAX_QUERY_SELECT || selectInput.some((item) => !validName(item)))) {
    fail('query_spec_invalid', `select must contain 1-${MAX_QUERY_SELECT} column names when provided`)
  }
  if (Array.isArray(selectInput)) assertUniqueNames(selectInput, 'select')

  const filters = input.filters === undefined ? [] : input.filters
  if (!Array.isArray(filters) || filters.length > MAX_QUERY_FILTERS) fail('query_spec_invalid', `filters must contain at most ${MAX_QUERY_FILTERS} conditions`)
  for (const filter of filters) {
    if (!isRecord(filter) || Object.keys(filter).some((key) => !['column', 'operator', 'value'].includes(key)) || !validName(filter.column)) fail('query_spec_invalid', 'each filter requires a valid column')
    const operators: QueryOperator[] = ['=', '!=', '>', '>=', '<', '<=', 'in', 'is_null', 'not_null']
    if (typeof filter.operator !== 'string' || !operators.includes(filter.operator as QueryOperator)) fail('query_spec_invalid', 'filter operator is invalid')
    const operator = filter.operator as QueryOperator
    if (operator === 'is_null' || operator === 'not_null') {
      if (own(filter, 'value')) fail('query_spec_invalid', `${operator} does not accept value`)
    } else if (!own(filter, 'value')) {
      fail('query_spec_invalid', `${operator} requires value`)
    }
    if (operator === 'in' && (!Array.isArray(filter.value) || filter.value.length === 0 || filter.value.length > 64)) fail('query_spec_invalid', 'in requires 1-64 values')
    if (own(filter, 'value')) {
      const values = operator === 'in' ? filter.value as unknown[] : [filter.value]
      if (values.some((value) => value === null || value === undefined)) fail('query_type_conflict', `${operator} cannot compare null; use is_null or not_null`)
      assertJsonSerializable(filter.value, 'filter value must be JSON-serializable')
    }
  }

  const groupBy = input.group_by === undefined ? [] : input.group_by
  if (!Array.isArray(groupBy) || groupBy.length > MAX_QUERY_GROUP_BY || groupBy.some((item) => !validName(item))) fail('query_spec_invalid', `group_by must contain at most ${MAX_QUERY_GROUP_BY} column names`)
  assertUniqueNames(groupBy as string[], 'group_by')

  const aggregates = input.aggregates === undefined ? [] : input.aggregates
  if (!Array.isArray(aggregates) || aggregates.length > MAX_QUERY_AGGREGATES) fail('query_spec_invalid', `aggregates must contain at most ${MAX_QUERY_AGGREGATES} items`)
  const normalizedAggregates: QueryAggregate[] = []
  const aggregateAliases = new Set<string>()
  for (const aggregate of aggregates) {
    if (!isRecord(aggregate) || Object.keys(aggregate).some((key) => !['function', 'column', 'as'].includes(key)) || !validName(aggregate.as)) fail('query_spec_invalid', 'each aggregate requires a valid as alias')
    const functions: QueryAggregateFunction[] = ['count', 'min', 'max', 'avg', 'sum']
    if (typeof aggregate.function !== 'string' || !functions.includes(aggregate.function as QueryAggregateFunction)) fail('query_spec_invalid', 'aggregate function is invalid')
    const fn = aggregate.function as QueryAggregateFunction
    if (fn === 'count') {
      if (own(aggregate, 'column') && !validName(aggregate.column)) fail('query_spec_invalid', 'count column must be a valid column name')
    } else if (!validName(aggregate.column)) {
      fail('query_spec_invalid', `${fn} requires a column`)
    }
    if (aggregateAliases.has(aggregate.as) || (groupBy as string[]).includes(aggregate.as)) fail('query_spec_invalid', `aggregate alias ${aggregate.as} collides with another result column`)
    aggregateAliases.add(aggregate.as as string)
    normalizedAggregates.push({ function: fn, ...(aggregate.column === undefined ? {} : { column: aggregate.column as string }), as: aggregate.as as string })
  }
  if (groupBy.length === 0 && normalizedAggregates.length === 0) fail('query_spec_invalid', 'query must include group_by or aggregates; raw row selection is not allowed (求首末/最新值请用 profile 的 time_facts，query 取不到原始行)')
  const resultColumns = [...groupBy as string[], ...normalizedAggregates.map((aggregate) => aggregate.as)]
  const select = selectInput === undefined ? resultColumns : selectInput as string[]
  for (const column of select) if (!resultColumns.includes(column)) fail('query_spec_invalid', `select column ${column} must be a group_by column or aggregate alias`)

  const orderBy = input.order_by === undefined ? [] : input.order_by
  if (!Array.isArray(orderBy) || orderBy.length > MAX_QUERY_ORDER_BY) fail('query_spec_invalid', `order_by must contain at most ${MAX_QUERY_ORDER_BY} items`)
  const normalizedOrderBy: QueryOrderBy[] = []
  for (const order of orderBy) {
    if (!isRecord(order) || Object.keys(order).some((key) => !['column', 'direction'].includes(key)) || !validName(order.column) || !['asc', 'desc'].includes(String(order.direction))) fail('query_spec_invalid', 'order_by item is invalid')
    if (!resultColumns.includes(order.column as string)) fail('query_spec_invalid', `order_by column ${order.column} is not a result column`)
    normalizedOrderBy.push({ column: order.column as string, direction: order.direction as QueryOrderDirection })
  }
  assertUniqueNames(normalizedOrderBy.map((item) => item.column), 'order_by')

  const limit = input.limit === undefined ? DEFAULT_QUERY_LIMIT : input.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) fail('query_spec_invalid', `limit must be between 1 and ${MAX_QUERY_LIMIT}`)
  const errorPolicy = input.error_policy === undefined ? 'skip_with_warning' : input.error_policy
  if (errorPolicy !== 'strict' && errorPolicy !== 'skip_with_warning') fail('query_spec_invalid', 'error_policy must be strict or skip_with_warning')
  const query: QuerySpec = {
    dataset_id: input.dataset_id,
    select,
    filters: filters as QueryFilter[],
    group_by: groupBy as string[],
    aggregates: normalizedAggregates,
    order_by: normalizedOrderBy,
    limit,
    error_policy: errorPolicy,
  }
  assertJsonSerializable(query, 'query must be JSON-serializable')
  if (byteLength(JSON.stringify(query)) > MAX_QUERY_SPEC_BYTES) fail('query_spec_invalid', `query exceeds ${MAX_QUERY_SPEC_BYTES} bytes`)
  return query
}

function availableColumns(rows: unknown[], contracts: EffectiveSchema): Set<string> {
  const columns = new Set(Object.keys(contracts))
  for (const row of rows) {
    if (isRecord(row)) for (const column of Object.keys(row)) columns.add(column)
    else columns.add('value')
  }
  return columns
}

function ensureColumns(query: QuerySpec, rows: unknown[], contracts: EffectiveSchema): void {
  const available = availableColumns(rows, contracts)
  const names = new Set<string>([
    ...(query.filters ?? []).map((filter) => filter.column),
    ...(query.group_by ?? []),
    ...(query.aggregates ?? []).flatMap((aggregate) => aggregate.column ? [aggregate.column] : []),
  ])
  for (const column of names) if (!available.has(column)) fail('query_column_not_found', `column ${column} is not present in Dataset`)
}

function normalizedComparable(value: unknown, contract: Contract | undefined, warnings: Set<string>, column: string): unknown {
  if (contract?.allowNumericString && typeof value === 'string' && numericString(value) !== undefined) {
    warnings.add(`column ${column} uses numeric-compatible string values`)
    return numericString(value)
  }
  return value
}

function incompatibleValue(
  policy: QueryErrorPolicy,
  warnings: Set<string>,
  detail: string,
): false {
  if (policy === 'strict') fail('query_type_conflict', detail)
  warnings.add(detail)
  return false
}

function compare(
  left: unknown,
  right: unknown,
  operator: QueryOperator,
  contract: Contract | undefined,
  warnings: Set<string>,
  column: string,
  policy: QueryErrorPolicy,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false
  const normalizedLeft = normalizedComparable(left, contract, warnings, column)
  const normalizedRight = normalizedComparable(right, contract, warnings, column)
  if (operator === '=' || operator === '!=') {
    const comparable = (typeof normalizedLeft === 'object' || typeof normalizedRight === 'object')
      || ['string', 'number', 'boolean'].includes(typeof normalizedLeft) && ['string', 'number', 'boolean'].includes(typeof normalizedRight)
    if (!comparable || (!sameType(normalizedLeft, normalizedRight) && typeof normalizedLeft !== 'object' && typeof normalizedRight !== 'object')) {
      return incompatibleValue(policy, warnings, `filter ${column} skipped incompatible value (${observedType(left)})`)
    }
    const equal = typeof normalizedLeft === 'object' || typeof normalizedRight === 'object'
      ? stableValue(normalizedLeft) === stableValue(normalizedRight)
      : sameType(normalizedLeft, normalizedRight) && normalizedLeft === normalizedRight
    return operator === '=' ? equal : !equal
  }
  if (operator === 'in') return (right as unknown[]).some((item) => compare(left, item, '=', contract, warnings, column, policy))
  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    if (operator === '>') return normalizedLeft > normalizedRight
    if (operator === '>=') return normalizedLeft >= normalizedRight
    if (operator === '<') return normalizedLeft < normalizedRight
    if (operator === '<=') return normalizedLeft <= normalizedRight
  }
  if (typeof normalizedLeft === 'string' && typeof normalizedRight === 'string') {
    if (operator === '>') return normalizedLeft > normalizedRight
    if (operator === '>=') return normalizedLeft >= normalizedRight
    if (operator === '<') return normalizedLeft < normalizedRight
    if (operator === '<=') return normalizedLeft <= normalizedRight
  }
  return incompatibleValue(policy, warnings, `filter ${column} skipped incompatible value (${observedType(left)})`)
}

function matchesFilters(
  row: unknown,
  filters: QueryFilter[],
  contracts: EffectiveSchema,
  warnings: Set<string>,
  policy: QueryErrorPolicy,
): boolean {
  for (const filter of filters) {
    const cell = rowCell(row, filter.column)
    if (filter.operator === 'is_null') {
      if (!isNullish(cell)) return false
      continue
    }
    if (filter.operator === 'not_null') {
      if (isNullish(cell)) return false
      continue
    }
    if (isNullish(cell)) return false
    if (!compare(cell.value, filter.value, filter.operator, contracts[filter.column], warnings, filter.column, policy)) return false
  }
  return true
}

function scalarGroupValue(value: unknown, column: string): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value ?? null
  fail('query_type_conflict', `group_by column ${column} must contain scalar values`)
}

function aggregateValue(
  aggregate: QueryAggregate,
  state: GroupState,
  contracts: EffectiveSchema,
  warnings: Set<string>,
  policy: QueryErrorPolicy,
): number | null {
  const values = aggregate.column
    ? state.rows.map((row) => rowCell(row, aggregate.column as string)).filter((cell) => !isNullish(cell))
    : []
  if (aggregate.function === 'count') return aggregate.column ? values.length : state.rows.length
  const column = aggregate.column as string
  const numbers: number[] = []
  for (const cell of values) {
    const number = numericValue(cell.value, contracts[column])
    if (number === undefined) {
      if (policy === 'strict') fail('query_type_conflict', `${aggregate.function} on ${column} encountered incompatible ${observedType(cell.value)} value`)
      warnings.add(`${aggregate.function} on ${column} skipped incompatible values`)
      continue
    }
    if (contracts[column]?.allowNumericString && typeof cell.value === 'string') warnings.add(`column ${column} uses numeric-compatible string values`)
    numbers.push(number)
  }
  if (numbers.length === 0) return null
  if (aggregate.function === 'min') return numbers.reduce((minimum, number) => Math.min(minimum, number), numbers[0])
  if (aggregate.function === 'max') return numbers.reduce((maximum, number) => Math.max(maximum, number), numbers[0])
  const sum = numbers.reduce((total, number) => total + number, 0)
  if (!Number.isFinite(sum)) fail('query_type_conflict', `${aggregate.function} on ${column} produced a non-finite result`)
  return aggregate.function === 'avg' ? sum / numbers.length : sum
}

function compareOrder(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined) return 1
  if (right === null || right === undefined) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftText = typeof left === 'string' ? left : stableValue(left)
  const rightText = typeof right === 'string' ? right : stableValue(right)
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0
}

export class JsonRowsQueryEngine {
  execute(rows: unknown[], schema: unknown, input: unknown): QueryResult {
    if (!Array.isArray(rows)) fail('query_rows_invalid', 'Dataset rows must be an array')
    const query = validateSpec(input)
    const contracts = extractContracts(schema)
    ensureColumns(query, rows, contracts)
    const warnings = new Set<string>()
    const policy = query.error_policy as QueryErrorPolicy
    const filtered = rows.filter((row) => matchesFilters(row, query.filters ?? [], contracts, warnings, policy))
    const groupBy = query.group_by ?? []
    const aggregateList = query.aggregates ?? []
    const groups = new Map<string, GroupState>()
    if (groupBy.length === 0) {
      groups.set('global', { values: {}, rows: filtered })
    } else {
      for (const row of filtered) {
        const values: Record<string, unknown> = {}
        for (const column of groupBy) values[column] = scalarGroupValue(rowCell(row, column).value, column)
        const key = stableValue(values)
        let group = groups.get(key)
        if (!group) {
          if (groups.size >= MAX_QUERY_GROUPS) fail('query_group_limit_exceeded', `query produced more than ${MAX_QUERY_GROUPS} groups`)
          group = { values, rows: [] }
          groups.set(key, group)
        }
        group.rows.push(row)
      }
    }

    const resultRows = [...groups.values()].map((group) => {
      const row: Record<string, unknown> = {}
      for (const column of groupBy) row[column] = group.values[column]
      for (const aggregate of aggregateList) row[aggregate.as] = aggregateValue(aggregate, group, contracts, warnings, policy)
      return row
    })
    const orderBy = query.order_by ?? []
    resultRows.sort((left, right) => {
      for (const order of orderBy) {
        const compared = compareOrder(left[order.column], right[order.column])
        if (compared !== 0) return order.direction === 'asc' ? compared : -compared
      }
      return 0
    })
    const limitedRows = resultRows.slice(0, query.limit)
    const selectedColumns = query.select ?? []
    const outputRows = limitedRows.map((row) => {
      const projected: Record<string, unknown> = {}
      for (const column of selectedColumns) projected[column] = row[column]
      return projected
    })
    const result: QueryResult = {
      dataset_id: query.dataset_id,
      columns: [...selectedColumns],
      rows: outputRows,
      matched_row_count: filtered.length,
      group_count: resultRows.length,
      returned_count: outputRows.length,
      limit: query.limit as number,
      warnings: [...warnings],
    }
    const encoded = JSON.stringify(result)
    if (byteLength(encoded) > MAX_QUERY_OUTPUT_BYTES) fail('query_result_too_large', `query result exceeds ${MAX_QUERY_OUTPUT_BYTES} bytes`)
    return result
  }
}

export function executeJsonRowsQuery(rows: unknown[], schema: unknown, query: unknown): QueryResult {
  return new JsonRowsQueryEngine().execute(rows, schema, query)
}
