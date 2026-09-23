import { MAX_QUERY_FILTERS, DatasetQueryError, type QuerySpec } from './query.js'
import { isRecord } from './args.js'
import type { ProfileTimeAxis, SessionLike, TimeAxisSnapshot } from './store.js'
import { isoDateFromEpoch, translateFilterDateValue } from './time-axis.js'

/**
 * 受控查询的**时间轴归一**：唯一实现，`query_dataset` 与 `describe_dataset.queries` 共用。
 *
 * ⛔ 2026-09-23 事故（会话 `66fa9666`）：这一层最初只接在 `query_dataset` 上，`describe_dataset`
 * 内嵌的 queries 直接走引擎，于是同一个模型在同一个回合里得到两种行为——
 *   - `query_dataset`：`">=": "2026-09"` → 正确当作 9 月区间；
 *   - `describe_dataset.queries`：`">=": "2026"` → 被引擎当**数字 2026** 比较，243 行全中
 *     （`days_2026: 243`，静默错误）；`">=": "2026-07"` → 整条被 `skip_with_warning` 跳过，
 *     `matched_row_count: 0`（静默空结果）。
 * 协议与委派消息都写着"时间筛选直接写日期串"，所以**只要有一个入口没接上，模型就一定踩**。
 * 新增任何"执行 QuerySpec"的入口都必须复用本模块，不要在别处再写一份。
 */

/**
 * 时间轴归一：把 filter 里的日期写法（`2026-08-23`、`2026-08`、`2026`、`{period:"last_3_months"}`）
 * 翻译成该 Dataset 时间列自己的边界值，并给结果补 `*_iso` 可读时间列。
 *
 * 为什么在工具边界做（真机会话 1e44050e 实测）：`date_ms` 列只接受毫秒，模型于是把
 * "近 1 月 / 近 3 月 / 52 周 / 年初至今 / 历年 10 月"全部手算成 epoch——单步思考 41,961
 * 字符里绝大部分是这类算术，而且算错就是错口径。日历换算是确定性计算，属于宿主：
 * 模型只写日历，宿主按**该列观测到的偏移**换算。
 *
 * 日期串落到数值时间列时**一律响亮失败**：旧路径下 `skip_with_warning` 会把这条 filter
 * 整条跳过（`filter X skipped incompatible value`），于是"筛选消失、返回全量"却看起来成功。
 */
export async function normalizeQueryDates(input: {
  store: TimeAxisProbe
  session: SessionLike
  dataset_id: string
  query: QuerySpec
  time_column?: string
  signal?: AbortSignal
}): Promise<{ query: QuerySpec; axis?: { column: string; time_zone?: string } }> {
  const filters = input.query.filters
  if (filters === undefined || !filters.some((filter) => /date|time|timestamp|_dt$|report$/i.test(filter.column))) return { query: input.query }
  let snapshot: TimeAxisSnapshot | undefined
  try {
    snapshot = await input.store.describeTimeAxis({
      session: input.session,
      dataset_id: input.dataset_id,
      time_column: input.time_column,
      signal: input.signal,
    })
  } catch {
    // 探针只服务"日期写法"这一便利：探针不可用（文档型 Dataset、不可读）时保持原样，
    // 让真正的查询路径去报它自己的错，不要在这里把错误提前成另一种。
    return { query: input.query }
  }
  if (snapshot === undefined) return { query: input.query }
  const axis = { axis: snapshot.axis, dates: snapshot.dates }
  const translated: QuerySpec['filters'] = []
  let changed = false
  for (const filter of filters) {
    const replaced = filter.column === axis.axis.column
      ? translateFilterDateValue({
        axis: axis.axis,
        dates: axis.dates,
        column: filter.column,
        operator: filter.operator,
        value: filter.value,
      })
      : undefined
    if (replaced === undefined) {
      translated.push(filter)
      continue
    }
    changed = true
    for (const item of replaced) {
      if (translated.length >= MAX_QUERY_FILTERS) {
        throw new DatasetQueryError('query_spec_invalid', `date filters expand to at most ${MAX_QUERY_FILTERS} conditions`)
      }
      translated.push({ column: filter.column, operator: item.operator as typeof filter.operator, value: item.value })
    }
  }
  return {
    query: changed ? { ...input.query, filters: translated } : input.query,
    axis: { column: snapshot.axis.column, ...(snapshot.axis.time_zone === undefined ? {} : { time_zone: snapshot.axis.time_zone }) },
  }
}

/** 时间轴只读探针：`WorkspaceDatasetStore` 与测试替身都满足这个形状。 */
export interface TimeAxisProbe {
  describeTimeAxis(input: { session: unknown; dataset_id: string; time_column?: string; signal?: AbortSignal }): Promise<TimeAxisSnapshot | undefined>
}

/**
 * 结果补 ISO 时间列：`date_ms: 1787414400000` 旁边给 `date_ms_iso: "2026-08-23"`。
 * 只加不删，原值仍是唯一权威（回传口径要求"字段按工具返回原样"）。
 * 已有同名 `*_iso` 列时不覆盖，避免与 Dataset 自带字段撞名。
 */
export function withIsoTimeColumns(result: Record<string, unknown>, axis: { column: string; time_zone?: string }): void {
  const rows = result.rows
  if (!Array.isArray(rows)) return
  const isoColumn = `${axis.column}_iso`
  const zone = axis.time_zone ?? 'UTC'
  for (const row of rows) {
    if (!isRecord(row) || isoColumn in row) continue
    const value = row[axis.column]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    row[isoColumn] = isoDateFromEpoch(value, zone)
  }
  const columns = result.columns
  if (Array.isArray(columns) && !columns.includes(isoColumn) && rows.some((row) => isRecord(row) && isoColumn in row)) {
    columns.push(isoColumn)
  }
}

