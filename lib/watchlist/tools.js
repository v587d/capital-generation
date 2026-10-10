import { dayDistance, readClock } from '../time/tools.js';
import { stripInvisibleText } from '../web-retriever/html-markdown.js';
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
/** ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。 */
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
const WATCHLIST_DENIED = '这不是"用户没有自选股"：清单读不到，一条都不许猜。';
/**
 * 一条记录 → 模型看见的那几格。**每个键都声明过**（§9.6：多一个未声明字段同样致命）。
 *
 * 两形态由 `held` 点名：未持仓的那一行**不出现** `weight_pct` / `holding_marked_*`——
 * "根本不是仓位"的时候谈"比例是 null 还是 0"没有意义，而把这三格摊给 30 行会让满载回包
 * 撞破体积预算（下面那条 6144 的闸门实测过）。三态仍然彼此可分：
 * `held:false` / `held:true` 且 `weight_pct:null`（标了没填） / `held:true` 且 `weight_pct:0`（真填 0）。
 *
 * 字段是照着"用户点名的四格 + 判断这句话还能信多久"选的，`added_age_days` 与 `pinned` 都不在这个
 * 问题里：添加日期就是事实本身，而清单**顺序**已经反映了置顶（服务端 `rowsOf` 给的读法）。
 */
function rowOf(row, today) {
    const stripped = stripInvisibleText(String(row?.name ?? ''));
    const thscode = String(row?.thscode ?? '');
    const addedAt = typeof row?.added_at === 'number' ? String(readClock(row.added_at).date) : today;
    const holding = row?.holding;
    const held = holding !== undefined;
    const markedAt = held && typeof holding?.marked_at === 'number' ? String(readClock(holding.marked_at).date) : null;
    // 天数下界取 0：机器时钟回拨过会让"N 天前"变成负数，那是没有意义的一句话；
    // 日期那一格仍给原值，所以异常照样看得见（不靠 clamp 把它藏起来）。
    const age = (date) => Math.max(0, dayDistance(date, today));
    return {
        thscode,
        // 上游名字里的零宽 / 方向覆盖符肉眼看不见，却能让"用户核对的那句话"与 Agent 收到的不一样
        // （设计文档 §3.2）；剥完为空就退回代码，不放一个空字符串上去。
        name: stripped.length > 0 ? stripped : thscode,
        asset_type: String(row?.asset_type ?? ''),
        added_date: addedAt,
        held,
        // ⛔ 持仓那一档里"没有这个数"就是 null，不是 0：用户在面板上勾了持仓、比例留空，
        // 把它写成 0% 等于替用户说了一句他没说的话（域 schema 同一口径，见 change_pct 那段）。
        ...(held ? { weight_pct: holding?.weight_pct ?? null } : {}),
        ...(markedAt !== null ? { holding_marked_date: markedAt, holding_marked_age_days: age(markedAt) } : {}),
    };
}
/** 成功回包。`limit` 只在宿主给了才带（那个数字归 `capital-watchlist` 所有，这里不抄一份）。 */
export function watchlistReceipt(rows, limit, now) {
    const today = String(readClock(now).date);
    const items = rows.map((row) => rowOf(row, today));
    return {
        ok: true,
        count: items.length,
        as_of_date: today,
        ...(typeof limit === 'number' ? { limit } : {}),
        items,
    };
}
function unavailable(code, message) {
    return { ok: false, code, message };
}
export function watchlistToolDefinition(source) {
    return {
        name: 'get_watchlist',
        description: '读取用户在本机「自选股」面板里维护的关注清单（跨 workspace 的用户级资产，条数有上限、由回包 `limit` 给出）：' +
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
                    // `required` 只列两种形态共有的五格；持仓那三格由 `held` 点名（§9.6 的多形态唯一姿势）。
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
        async execute() {
            const service = source();
            if (service === undefined || typeof service.list !== 'function') {
                // ⛔ 绝不回空清单：装配里少了 host 平面那一行与"用户一条自选都没加"在回包上必须长得不一样。
                return unavailable('watchlist_unavailable', `自选股服务没有挂载（capital-watchlist 那行没起来）。${WATCHLIST_DENIED}`);
            }
            let result;
            try {
                result = await service.list();
            }
            catch (error) {
                const cause = error instanceof Error ? error.message : String(error);
                return unavailable('store_unavailable', `自选股存储读不到：${cause || 'unknown'}。${WATCHLIST_DENIED}`);
            }
            if (result?.ok !== true || !Array.isArray(result.items)) {
                return unavailable('store_unavailable', `自选股清单没有取回来（回包 ok 不是 true）。${WATCHLIST_DENIED}`);
            }
            return watchlistReceipt(result.items, result.limit, Date.now());
        },
    };
}
/**
 * 注册 `get_watchlist`（主 Agent 的工具；`capital-generation-scope` 组里注册 = 主 Agent 与
 * 全部 child 都看得见，所以通用 `subagent` 行必须把它 deny 掉，见 preset 的 agent.patch.yml）。
 *
 * 会话级数据（Dataset / profile / chart）走 workspace，而自选股是**宿主级用户资产**：
 * 本工具不读 `{{cwd}}`、不碰 `~/.dsh/storages/` 那个文件，只调那一路唯一的宿主服务
 * （设计文档 §2.4：不允许另建一份存储）。
 */
export function registerWatchlistTool(ctx) {
    const tools = ctx.get('tools');
    if (tools === undefined)
        return;
    ctx.effect(() => tools.register(watchlistToolDefinition(() => {
        // ⛔ 服务只在**每次调用**时现取（AGENTS.md §9.7 ⑤）：`capital-watchlist` 是 host 平面行，
        // 它的 provide 与本 preset 行的装配先后不由我们决定。装配期取一次，就等于把一次抢跑
        // 钉成"用户的自选股整个进程读不到"（桌面端 2026-09-30 那 61 条能力缺席是同一族形状）。
        try {
            return ctx.get('capitalWatchlist');
        }
        catch {
            return undefined;
        }
    })), 'capital-generation.tool(get_watchlist)');
}
