import type { Context } from '@deepseek-ai/cordis'
import { dayDistance, readClock } from '../time/tools.js'
import { stripInvisibleText } from '../web-retriever/html-markdown.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }

/** Slice of the host-plane `capitalWatchlist` service this tool reads; writes happen only in the panel. */
interface WatchlistRow {
  readonly thscode?: string
  readonly name?: string
  readonly asset_type?: string
  readonly added_at?: number
  readonly pinned_at?: number
  readonly holding?: { readonly weight_pct?: number | null; readonly marked_at?: number }
}

interface WatchlistListResult {
  readonly ok?: boolean
  readonly items?: WatchlistRow[]
  readonly limit?: number
}

interface WatchlistServiceLike {
  list?(): Promise<WatchlistListResult>
}

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object =>
  ({ type: 'object', properties, required, additionalProperties: false })

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const WATCHLIST_DENIED = '这不是"用户没有自选股"：清单读不到，一条都不许猜。'

/** Held rows may carry weight/marked fields; `held:true` with `weight_pct:null` stays distinct from 0. */
function rowOf(row: WatchlistRow, today: string) {
  const stripped = stripInvisibleText(String(row?.name ?? ''))
  const thscode = String(row?.thscode ?? '')
  const addedAt = typeof row?.added_at === 'number' ? String(readClock(row.added_at).date) : today
  const holding = row?.holding
  const held = holding !== undefined
  const markedAt = held && typeof holding?.marked_at === 'number' ? String(readClock(holding.marked_at as number).date) : null
  // Clamp the age at 0 so a clock rollback cannot produce a negative "days ago"; the date itself stays raw.
  const age = (date: string) => Math.max(0, dayDistance(date, today))
  return {
    thscode,
    // Strip invisible characters so the name the user sees matches what the agent reads; fall back to the code.
    name: stripped.length > 0 ? stripped : thscode,
    asset_type: String(row?.asset_type ?? ''),
    added_date: addedAt,
    held,
    // Empty weight stays null, not 0: writing 0 would put a claim in the user's mouth.
    ...(held ? { weight_pct: holding?.weight_pct ?? null } : {}),
    ...(markedAt !== null ? { holding_marked_date: markedAt, holding_marked_age_days: age(markedAt) } : {}),
  }
}

export function watchlistReceipt(rows: WatchlistRow[], limit: number | undefined, now: number): Record<string, unknown> {
  const today = String(readClock(now).date)
  const items = rows.map((row) => rowOf(row, today))
  return {
    ok: true,
    count: items.length,
    as_of_date: today,
    ...(typeof limit === 'number' ? { limit } : {}),
    items,
  }
}

function unavailable(code: string, message: string): Record<string, unknown> {
  return { ok: false, code, message }
}

export function watchlistToolDefinition(source: () => WatchlistServiceLike | undefined) {
  return {
    name: 'get_watchlist',
    description:
      '读取用户在本机「自选股」面板里维护的关注清单（跨 workspace 的用户级资产，条数有上限、由回包 `limit` 给出）：' +
      '证券代码、名称、类型、添加日期、是否持仓，以及用户自报的持仓占比与标记日期。行的顺序就是面板的顺序' +
      '（置顶在前）。**只读**——添加、移除、标记持仓都只能由用户在面板里做，本工具没有任何写入口。\n' +
      '每行都由 `held` 点名形态：`held:false` 是纯关注、不带比例两格；`held:true` 时 `weight_pct` 是用户填的占比，' +
      '`weight_pct:null` 表示"标了持仓但比例还没填"（不是 0%）。`held` 与 `weight_pct` 都是**用户自报**且带标记日期' +
      '（`holding_marked_date` / `holding_marked_age_days`）：只有标过的条目才是仓位，未标的条目只是关注清单，' +
      '不得据此推断用户持有什么；占比是否含现金、合计是否到 100% 只有用户自己知道，不自行折算或补满，' +
      '但面板**只做多、不算 put**，所以那一叠比例被挡在合计 120% 以内（每一格最多 100）。' +
      '面板只为可交易的证券（A 股 / 场内 ETF / 港股 / 美股）提供这一标记，**指数不是一个可持有、可配比率的标的**，' +
      '所以 `asset_type` 带 `-index` 的那几档通常 `held:false`。' +
      '标记距今较久（`holding_marked_age_days` 大，或用户说过"最近调过仓"）时，先向用户确认这份仓位仍然成立，' +
      '再拿它做组合判断。\n' +
      '本工具不含成本、股数与买卖流水，也**不返回报价或涨跌**：行情、财务与历史数值一律委派 data_collector。' +
      '两种"没有内容"必须分开说：`ok:false` + `code` 是清单读不到，`ok:true` 且 `count:0` 才是用户确实没有自选股。',
    parameters: jsonObject({}),
    output: {
      schema: jsonObject({
        ok: { type: 'boolean' },
        code: { type: 'string' },
        message: { type: 'string' },
        count: { type: 'integer' },
        limit: { type: 'integer' },
        as_of_date: { type: 'string' },
        items: {
          type: 'array',
          // `required` lists only the five shared fields; held-only fields are keyed by `held`.
          items: jsonObject({
            thscode: { type: 'string' },
            name: { type: 'string' },
            asset_type: { type: 'string' },
            added_date: { type: 'string' },
            held: { type: 'boolean' },
            weight_pct: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            holding_marked_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            holding_marked_age_days: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          }, ['thscode', 'name', 'asset_type', 'added_date', 'held']),
        },
      }, ['ok']),
      render,
    },
    async execute(): Promise<Record<string, unknown>> {
      const service = source()
      if (service === undefined || typeof service.list !== 'function') {
        // Never return an empty list: a missing host row must look different from "user has no watchlist".
        return unavailable('watchlist_unavailable', `自选股服务没有挂载（capital-watchlist 那行没起来）。${WATCHLIST_DENIED}`)
      }
      let result: WatchlistListResult | undefined
      try {
        result = await service.list()
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error)
        return unavailable('store_unavailable', `自选股存储读不到：${cause || 'unknown'}。${WATCHLIST_DENIED}`)
      }
      if (result?.ok !== true || !Array.isArray(result.items)) {
        return unavailable('store_unavailable', `自选股清单没有取回来（回包 ok 不是 true）。${WATCHLIST_DENIED}`)
      }
      return watchlistReceipt(result.items, result.limit, Date.now())
    },
  }
}

/**
 * Register get_watchlist (main agent + all children; the subagent row must deny it). Host-level user
 * data: read it only through the host service, never a second store.
 */
export function registerWatchlistTool(ctx: Context): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (tools === undefined) return
  ctx.effect(() => tools.register(watchlistToolDefinition(() => {
    // Resolve the service at call time: host-plane row order is not ours, and caching a startup miss
    // would hide the user's watchlist for the whole process.
    try {
      return ctx.get('capitalWatchlist') as WatchlistServiceLike | undefined
    } catch {
      return undefined
    }
  })), 'capital-generation.tool(get_watchlist)')
}
