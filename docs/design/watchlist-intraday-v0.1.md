# 自选股「当日分时」数据接入与走势图方案（v0.1）

> 状态：**已实现**（2026-11-18，2.27.0）。实现与稿子的差异见 §10。
> 入口：`watchlist/client.src.cjs`（工作台右栏两块占位）、`watchlist/index.js`（宿主路由）。
> 关联：`docs/design/user-watchlist.md`（模块现行契约）、`docs/design/watchlist-hk-us.md`（港美股走腾讯公开行情）、
> `docs/design/data-capability-expansion.md`（Fuyao 能力级不可用的先例）。
> 本文只定数据来源、契约、交互与验收；实现前先过 §9 的待拍板项。

---

## 0. 一页结论

### 0.1 现状：两块占位不是没画，是没数据

工作台右栏现在有两个块：`当日分时`（虚线框 + 文案「当前行情接口只返回最新快照」）与 `成交量`（「暂无成交量数据」）。
占位文案本身是准确的：自选股全链路只有**快照**——A 股走 Fuyao `prices/snapshot`，港美股走腾讯
`qt.gtimg.cn` 快照，每条记录只持久化 `price / change_pct / captured_at / source_ts / source_time / currency`
（`watchlist/index.js` 的 `quoteSchema`）。**没有任何一条序列**，所以不存在"前端没接上"的情况。

### 0.2 根因：Fuyao 的分时是"文档有、接口关"

`docs/reference/fuyao/llm_full.md` 里确有 `/api/a-share/high-frequency/intraday`（单日分时）与
`/api/a-share/high-frequency/historical`（1 分钟），但同一页顶部的告示写明"该能力暂未开放外部接入"，
本仓实测是 `code=2004`（`docs/design/data-collector-fuyao-expansion.md` 已把它升级为一等错误语义：能力级不可用、不要重试）。
即便将来开放，这两颗的字段也只有 `date_ms / hf_direction / hf_participation`——**没有价格、没有成交量**，
画不出价格走势图。所以分时这条线只能另找来源，A 股没有"官方 key"的选项。

### 0.3 选定方案

**腾讯分时（`appstock/app/minute/query`）覆盖 A 股与港股，东财分时（`push2his .../trends2/get`）覆盖美股。**
两条都零 key、都是本仓已经在用的公开行情宿主（`web.ifzq.gtimg.cn` 已是 A 股分钟 K 线宿主，
`push2his.eastmoney.com` 已是全球指数日 K 宿主），不是新引入的第三方。

一句话链路：

```text
工作台选中一行 ──► GET /capital-watchlist/trend?thscode=…（认证围栏 + 只认清单里的标的）
                      ├─ A股 / 港股：腾讯 minute/query（120ms 链，与现有报价同一条）
                      └─ 美股：东财 trends2（1000ms 进程链，与 eastmoney 工具共用）
                    ──► { prev_close, open/high/low/last, avg, volume, amount, points[] }
                    ──► 右栏 SVG 走势图（价格面积 + 均价线 + 昨收基准 + 成交量柱 + 十字光标）
```

### 0.4 本期不做

- **不做 5 日视图**：腾讯 minute 只有当日；东财 `ndays=5` 三市场都给，但会让同一张图的两个尺度来自两条源（1 日贴邻切 5 日时口径对不上），本期先把 1 日做实。
- **不做列表行迷你走势**：一次请求一只，30 行 × 1 req = 30 秒（东财链 1 req/s），会把交互拖垮。
- **不把分时注册成模型工具**：本期只服务工作台；`get_intraday_trend` 会动能力目录与工具表，另案。
- **不补零、不插值、不猜时区**：源没有的点就是没有（§3.5）。

---

## 1. 需求与验收点

| # | 需求 | 验收点 |
|---|---|---|
| R1 | 选中标的即在右侧画出**当日**分时 | 切换行 ≤1.5s 出图；A 股 / 港股 / 美股三个市场族都有图；数据点用完即弃，不落盘 |
| R2 | 图要有昨收基准，涨跌一眼可读 | 虚线基准在 `prev_close`；线上方红、下方绿（A 股惯例，沿用 `--capital-watchlist-up/down`）；右轴百分比 |
| R3 | 均价线与成交量 | A 股/港股/美股**个股**给均价线；成交量柱按分钟方向着色；指数不画均价线（见 §3.2 的逐源映射） |
| R4 | 只有用户的动作才出网 | 选中一次 = 一次上游请求；手动刷新按一次；**无轮询、无定时器、无预取**（与模块 R5 的"打开即刷新一次"同一条纪律） |
| R5 | 上游不可用不能拖垮工作台 | 分时块内联报错/空态 + 重试；列表、报价、分组全不受影响；错误码可定位 |
| R6 | 不越权取数 | 路由只接受**清单里已存在**的 `thscode`；客户端不能借它当任意行情代理 |
| R7 | 数据不撒谎 | 超过 10 分钟没有新点、或只有上一交易日的数据，必须在图上标出来（`session_status`），不把昨天的图当今天 |
| R8 | 合规与回归 | 不新增上游 host（两条都已在用）；`npm test` + `npm run check:dsh` 全绿；新增解析器全部由**真报文 fixture** 覆盖 |

---

## 2. 数据能力实测（2026-11-18 08:0x Asia/Shanghai，最近交易日 2026-11-17）

> 全部为当机 curl 真报文；复现命令见 §8。

### 2.1 腾讯分时 `web.ifzq.gtimg.cn/appstock/app/minute/query?code=<symbol>`

响应结构：`data.<symbol>.data = { date, data: ["0930 1458.88 442 64482496.00", …] }`，
`data.<symbol>.qt.<symbol>` 是与报价同布局的字段数组。

| 实测 | 结果 |
|---|---|
| `sh600519` | 267 点，09:30–15:30（含 **15:06–15:30 收盘后补点**：价格恒 1457.70、累计量只从 35,116 爬到 35,123） |
| `sh000001` / `sz399001` | 242 点；指数无补点 |
| `sh510300` / `sz159915` | 267 点，ETF 同上 |
| `hk00700` | 332 点，09:30–16:08；**16:08 一个收盘竞价点**（376.000，前一点 15:59 为 376.800） |
| `hkHSI` / `hkHSCEI` / `hkHSTECH` / `hkHSCCI` | 332 点，**港股指数全覆盖** |
| `usAAPL` / `usIXIC` / `usINX` | **只有 1 行、无 `date`** → 腾讯这条没有美股分时 |

字段口径（同一条响应里就够用，不用二次请求）：

- 每行 `HHMM price cum_volume cum_amount`：`cum_volume` / `cum_amount` 是**当日累计**，不是分钟量。
- `qt[3]` 最新价、`qt[4]` **昨收**、`qt[5]` 今开、`qt[6]` 成交量。
  逐条核对：`sh600519` 收 1457.70 / 昨收 1453.90 / 开 1458.88；`sh000001` 3584.58 / 3602.57；
  `sh510300` 4.042 / 4.054；`hkHSI` 23508.170 / 23753.840。
- 15:00 那一点的累计量 = 快照 `volume`（`sh600519` 两边都是 35,116）**逐位相等**——这是"截到 15:00"的验收依据。

### 2.2 东财分时 `push2his.eastmoney.com/api/qt/stock/trends2/get?secid=…&ndays=1`

响应：`data.preClose`、`data.beticks`（当日时段刻度，见下）、`data.decimal`、`data.trends`
（`"YYYY-MM-DD HH:MM,open,close,high,low,volume,amount,avg"`）。

| 实测 | 结果 |
|---|---|
| `1.600519` | 241 点（09:30–11:30、13:01–15:00）；`preClose` 1453.9；`beticks` `33300｜34200｜54000｜34200｜41400｜46800｜54000`（秒：09:15 / 09:30 / 15:00 / 09:30 / 11:30 / 13:00 / 15:00） |
| `1.000001` / `0.399001` / `0.000001` / `1.510300` / `0.159915` | 均 241 点，`preClose` 齐 |
| `116.00700` / `100.HSI` / `100.HSCEI` | 331 点；**收盘竞价并进 16:00 那一点**（00700 在该点就是竞价价 376.000） |
| `100.HSTECH` / `100.HSCCI` | `rc=100`，**无数据** |
| `105.AAPL` / `106.BABA` / `107.UUUU` | 391 点；`preClose` 352.78 / 90.62 / —；`107` 就是 NYSE American |
| `105/106/107.TCEHY` | 全空 → **美股 OTC（腾讯后缀 `.PS`）没有分时** |
| `100.NDX` / `100.SPX` / `100.DJIA` | 391 点；`100.IXIC` / `100.DJI` 空 → **美股指数必须走别名表** |
| `ndays=5` | `1.600519` 1205 点（5 个交易日）、`105.AAPL` 1955 点（7 个自然日） |

`avg` 列是价格量纲（600519 收在 1450.772，AAPL 351.8394），可以直接当均价线；
指数行 `amount` 实测为 0.00（NDX/SPX/DJIA），只有 HSI/HSCEI 带成交额。

### 2.3 不适合的候选（逐条否决理由）

| 候选 | 为什么不用 |
|---|---|
| Fuyao `high-frequency/*` | `code=2004` 外部不可用；且字段只有 `hf_direction`，没有价格/量 |
| 腾讯 `mkline` m1（也是 `tencent_kline` 的口径） | 仅 SH/SZ（港股 `code=-1`、美股空）；240 根只有 OHLC、**无均价**；且它是数据面 capability，宿主复用要把 hub 拖进 watchlist 包 |
| 腾讯 `ticks`（`get_tencent_ticks`） | 分笔明细，最多 300 页，只 SH/SZ 个股/ETF，指数不接受；太重 |
| Wind `wind_stock_kline` | 日线；需要 key；同一目录下没有分时 |
| FTShare 15 分钟切片 | 是主力资金五档净额，不是价格序列 |

### 2.4 覆盖矩阵（按 `asset_type`）

| asset_type | 腾讯 minute | 东财 trends2 | 本期走 |
|---|---|---|---|
| `a-share` | ✅ 个股/ETF | ✅ | 腾讯 |
| `a-share-index` | ✅ | ✅ | 腾讯 |
| `fund-etf` | ✅ | ✅ | 腾讯 |
| `hk-stock` | ✅ | ✅ | 腾讯 |
| `hk-index` | ✅ 全指数 | ⚠️ 只 HSI/HSCEI | 腾讯 |
| `us-stock` `.OQ/.N/.AM` | ❌ | ✅ | 东财 |
| `us-stock` `.PS`（OTC） | ❌ | ❌ | **空态**（明确不可用，不发请求） |
| `us-index` `IXIC/INX/DJI` | ❌ | ✅（别名 NDX/SPX/DJIA） | 东财 |
| `us-index` 其他 | ❌ | ❌ | **空态** |

### 2.5 选型理由（不是"哪个能跑用哪个"）

1. **A/港走腾讯**：符号身份已经解析好（`parseSecurityCode().tencentSymbol`，搜索与报价都在用），
   零新增身份表；链路 120ms，而东财是**全进程 1000ms** 串行（`EASTMONEY_MIN_INTERVAL_MS`），
   工作台切行是交互动作，排在 1s 队列后面体感是"卡"。
2. **港股指数只能走腾讯**：东财 `100.HSTECH` / `100.HSCCI` 无数据，而腾讯 `hkHSTECH` / `hkHSCCI` 都有。
   若 A/港也走东财，仍要为港指数保留腾讯——那就已经是两条源，不如按市场分干净。
3. **美股只能走东财**：腾讯这条没有美股分时（只回 1 行）。
4. **两条源都已在仓内**：`web.ifzq.gtimg.cn` 是 `tencent-http.ts` 的 K 线宿主之一，
   `push2his.eastmoney.com` 是 `eastmoney-http.ts` 的全球指数日 K 宿主。不新增出网白名单条目。

---

## 3. 方案

### 3.1 分层

```text
src/sources/trend-series.ts         ← 新增：唯一的"分时序列"实现（解析 + 归一 + 目标解析）
   ├─ tencent-public-core.ts        ← 复用：tencentThrottle(120ms)、getText、字段守卫
   ├─ net/eastmoney-client.ts       ← 复用：sharedEastmoneyClient（全进程 1s 链）
   └─ security-code.ts              ← 复用：parseSecurityCode → tencentSymbol
watchlist/index.js                  ← 新增 GET /trend：认证围栏 + 清单闸门 + 60s 缓存 + 单飞
watchlist/client.src.cjs            ← 新增 SVG 走势图组件（无图表库）+ 取数 hook + i18n + 样式
```

`trend-series.ts` 是**叶子**（只依赖 `tencent-public-core` / `net/*` / `security-code`），不 import
data-collector hub——`watchlist/index.js` 通过 `lib/` 引用它，与现在引 `fuyao-core` / `tencent-public-core` 同一姿势。

**一处小重构**：`tencent-http.ts` 里的 `KLINE_HOSTS`（三个 ifzq 备选宿主）与 `hostDownUntil` 冷却表要
上提到 `tencent-public-core.ts`，由 K 线与分时共用一份宿主故障转移；否则同一个 host 在两条路径上各冷却各的，
会出现"K 线判它挂了、分时还在打它"。`tencent-http.ts` 改为 import，行为不变，其测试需跟着核对。

### 3.2 归一化行契约

两个源统一成五元组，**时间只给交易所本地 `HH:MM`**（客户端不做时区换算，`session_date` 另给）：

```ts
type TrendPoint = [time: string, price: number, avg: number | null, volume: number | null, amount: number | null]

interface TrendPayload {
  thscode: string
  source: 'tencent' | 'eastmoney'
  market: 'a-share' | 'hk' | 'us'
  tz: 'Asia/Shanghai' | 'Asia/Hong_Kong' | 'America/New_York'
  session_date: string | null      // 交易所本地交易日；源没有就 null
  session_status: 'live' | 'closed' | 'previous'   // 宿主按交易所本地时钟算
  prev_close: number               // 必填：没有前收就不出图
  open: number | null
  high: number | null
  low: number | null
  last: number | null              // 官方最新价（港股已含收盘竞价点，与序列末点一致）
  avg: number | null               // 全日均价（末点），指数为 null
  volume: number | null            // 全日量（腾讯 = 末点累计；东财 = 逐点求和）
  amount: number | null            // 全日额；美股指数为 null
  volume_unit: 'lot' | 'share' | null   // A 股 手、港美股 股、指数 null（口径未核实的不写）
  currency: string | null          // 指数 null
  points: TrendPoint[]             // ≤ 400
}
```

**逐源映射**

| 字段 | 腾讯（A/港） | 东财（美） |
|---|---|---|
| `time` | 行首 `HHMM` → `HH:MM` | 行内时间的 `HH:MM` |
| `price` | 行内价 | `close`（第 3 列） |
| `avg` | `cum_amount ÷ (cum_volume × 100)`（A 股手）/ `÷ cum_volume`（港股股）；**指数 null** | 第 8 列；**指数 null**（amount=0，那一列是指数点位均值，与个股 VWAP 不是一回事） |
| `volume`（点） | `cum[i] − cum[i−1]`，递减即 `tencent_invalid_response`（不夹取） | 第 6 列 |
| `amount`（点） | `cum_amt[i] − cum_amt[i−1]` | 第 7 列（0 → null） |
| `prev_close` | `qt[4]` | `data.preClose` |
| `open/high/low` | `qt[5]` / 序列 max / 序列 min | 首行 open / 序列 max / min |
| `last` | `qt[3]` | 末点 close |

**截断规则（关键）**

- A 股：保留 `time ≤ 15:00`。15:06–15:30 是收盘后补点（价格恒为收盘价、量只增几手），留着会把右端拉成 25 分钟横线。
- 港股：保留 `time ≤ 16:00` 的连续竞价点，再把源另给的收盘竞价点（实测时间戳 16:08、价格 376.000）**追加为最后一点**：
  它是真实成交价，而且这样序列末点与 `qt[3]` 必然一致；tooltip 显示原始时刻，x 轴刻度仍按 16:00 收盘。
- 美股：东财本身只给正股时段（391 点，09:30–16:00 交易所本地），没有盘前盘后。

### 3.3 宿主路由

```text
GET /capital-watchlist/trend?thscode=<canonical>&refresh=0
```

- **认证**：沿用 `authorize(req)`（`connection.requestRejection`），401/403 文案不变。
- **闸门**：`service.list()` 里没有这个 `thscode` → `404 not_watched`。`asset_type` / `exchange` 只从存储里取，
  **不接受客户端传身份**（否则就是任意行情代理）。
- **成功**：`200 { ok: true, ...TrendPayload }`，`cache-control: no-store`（与其他路由一致）。
- **失败**：`{ ok:false, code }`，`code ∈ { invalid_query, not_watched, trend_unavailable, trend_timeout,
  trend_parse_failed }`，HTTP 码沿用 `sendBusiness` 的映射表。
- **缓存**：进程内 `Map<thscode, {at, payload}>`，TTL 60s，上限 64 条（超限删最早插入的），
  同一 key 的并发请求单飞（共享同一个 Promise）。`refresh=1` 跳过读缓存。
- **取消**：上游 10s `AbortController`；超时 → `trend_timeout`。

### 3.4 为什么"当日"可以被信任

`session_status` 由宿主用交易所本地时钟算，客户端只照抄：

| 条件 | 取值 | UI |
|---|---|---|
| `session_date` == 交易所今天 且 在交易时段内 | `live` | 标题右侧「盘中」，并显示最后一点时间 |
| `session_date` == 交易所今天 且 已收盘 | `closed` | 「11-17 收盘」 |
| 其他（盘前、周末、假期、停牌无数据） | `previous` | 「上一交易日 11-17」小胶囊 |

`live` 但最后一点比交易所当前时间早 10 分钟以上 → 客户端在块头标「数据滞后」，不假装实时。

### 3.5 数据纪律（照抄本仓既有口径）

1. **不补零**：停牌/无量的点只可能来自源，源没有就不给；`null` 不是 0。
2. **不插值**：午休、缺口就是缺口，x 轴按点序排，不按真实分钟数排。
3. **不猜单位**：指数成交量口径没核实（手 vs 股），`volume_unit` 给 `null`，UI 只显示数量不写单位。
4. **不吞咽异常**：行数不足 6 段、时间倒流、累计量递减、`preClose` 缺失——一律 `trend_parse_failed` 并带上游原话，
   降级成空态，不做"少画一半"的图。

---

## 4. 交互与视觉

### 4.1 布局（右栏，合并现有的两块占位）

```text
┌──────────────────────────────────────────────────────────────┐
│ 贵州茅台  A股                                      600519.SH │
│ 1,457.70  +0.26%  +3.80                        [11-17 收盘]  │
│ 今开 1,458.88  最高 1,461.60  最低 1,437.71  均价 1,450.77    │
│ 成交量 35,116  成交额 50.95亿                                 │
├──────────────────────────────────────────────────────────────┤
│ 当日分时                                    A股时间 · 最后 15:00│
│ 1,461.60 ┤         ╭─╮                                       │
│          │     ╭───╯ ╰──╮                                    │
│ 1,453.90 ┼─────╯────────╰────────  ← 昨收虚线                 │
│          │   ╱            ╲                                  │
│ 1,437.71 ┤──╯               ╲                                │
│          09:30   10:30   11:30/13:00   15:00                 │
├──────────────────────────────────────────────────────────────┤
│ 成交量 35,116                                    （柱状，红/绿）│
└──────────────────────────────────────────────────────────────┘
```

- 价格面板 `flex:1`，成交量面板固定 72px，中间 1px 分隔；总高仍由 `--cwd-body-h` 兜住，不出现第二个滚动条。
- 图表块替换「当日分时」与「成交量」两块，**不再有第二个块标题**——成交量只是图的一层，不是独立信息块。

### 4.2 图形元素

| 元素 | 规格 |
|---|---|
| 价格线 | 折线（不插值、不平滑）、1.5px、`--capital-watchlist-up/down` 按 `last vs prev_close` 取色 |
| 面积 | 同色渐变（18% → 0），沿价格线下缘闭合到图底 |
| 昨收基准 | 1px 虚线 `--dsw-alias-label-tertiary`，右轴 0.00% 对齐 |
| 均价线 | 1px 实线 `--dsw-alias-state-business-primary`（原稿写虚线，SVG 按像素坐标画时虚线间隔得跟宽度走，先保清晰）；指数没有这一层 |
| 网格 | 4 条横向虚线，`color-mix(border-l2, transparent 55%)`；纵向只画午休/收盘分界 |
| 左轴 | 价格，沿昨收上下对称取值域，`toFixed(2)`，11px `tabular-nums` |
| 右轴 | 相对昨收百分比，`+x.xx%`，同色 |
| 成交量柱 | 宽度 `plot/n − 1`，按该分钟涨跌着色（55% 透明），高度按当日最大单分钟归一 |
| 十字光标 | 竖线 + 横向贯穿虚线 + 左轴价格气泡 + 时间气泡 + 浮动卡片（时间/价/涨跌幅/均价/量） |
| 空态/加载 | 骨架条复用现有 `.cwd-skeleton`；空态给**可读原因**（不支持该市场、无当日数据、上游超时） |

### 4.3 状态机

`idle`（未选标的，复用现有 `desk.selectHint`）→ `loading`（骨架）→ `ready` /
`unavailable`（`trend_unavailable`：`.PS`、冷门指数、停牌）/
`error`（超时/解析失败，带「重试」按钮，一次点击只重试一次）。

`previous` 状态不是错误，是**数据事实**：图照画，标题右侧挂日期胶囊。

### 4.4 与设计规章的对齐

- 颜色只走 token（新增的颜色只有两个沿用中的 `--capital-watchlist-up/down`，不引入新 hex）。
- 没有下拉、没有日期控件；图表块内唯一的控件是「重试」按钮（34px 高、10px 圆角、带焦点环）。
- 图不是可聚焦控件：`role="img"` + `aria-label` 概述（"贵州茅台 2026-11-17 分时：开 1458.88，高 1461.60，低 1437.71，收 1457.70，涨 0.26%"），十字光标只跟指针，不抢键盘焦点。

---

## 5. 测试矩阵与改动面

### 5.1 新增

| 文件 | 覆盖 |
|---|---|
| `test/watchlist-trend.test.mjs` | 腾讯 A/港解析（截断、累计差、均价、`qt` 取昨收）；东财美股解析（别名表、`preClose`、`amount=0→null`）；`.PS` 不发请求直接 `trend_unavailable`；累计量递减/时间倒流/行数不足 → `trend_parse_failed`；60s 缓存与单飞；`session_status` 的三种取值（注入 now） |
| `test/trend-fixtures.mjs` | 4 份真报文（照 `test/tencent-fixtures.mjs` 的模块式 fixture）：`sh600519`（含收盘后补点）、`sz399001`、`hk00700`（含 16:08 竞价点）、`105.AAPL` |
| `scripts/smoke-trend.mjs` | 手工实时核对（**不进 `npm test`**，与 `smoke-fuyao.mjs` 同性质） |

### 5.2 同步修改

- `test/watchlist-route.test.mjs`：`/trend` 认证、`not_watched`、成功体、缓存命中（上游只被打一次）、错误映射。
- `test/watchlist-client.test.mjs`：两处占位断言（`desk.intradayEmpty` / `desk.volumeEmpty`）替换为图表断言；
  价格/涨跌幅、`previous` 胶囊、空态与错误态、`aria-label`、无新 hex。
- `watchlist/client.js`：`npm run build:watchlist-client` 重新生成。
- `CHANGELOG.md` / 版本号：2.26.0 → **2.27.0**（新能力，按 minor 走），README 版本徽章同步。

### 5.3 明确零改动

`src/data-collector/*`、`src/chart/*`、`preset/*`、工具表与能力目录（`docs/data-collector-capabilities.md`
与 `list_capabilities` 的 132 条不变）、`automation/*`、`chart-ui/*`、`config/*`。

---

## 6. 风险与回退

| 风险 | 处置 |
|---|---|
| 腾讯/东财网页接口改版 | 解析器响亮失败 → 空态 + 错误码；列表与报价不受影响；真报文 fixture 让回归在 CI 里可见 |
| 东财 1s 链被工具流量占满（美股图排队） | 60s 缓存 + 骨架 + 单飞；仍慢就退化为"点击后 1s 内出图"的预期，不做预取 |
| 境外 IP / 反爬 | 未核（与现有港美报价同一风险面）；失败即空态 |
| 客户端体积 | 纯 SVG 手写，预估 +12~15KB（现约 73KB），无新依赖 |
| 数据口径争议（指数成交量的手/股） | 不写单位，`volume_unit: null` |
| 回退 | 路由与图表块都在自选股包内：删 `/trend` + 恢复两块占位即可，不触及其他模块 |

---

## 7. 交付清单（按实施顺序）

1. `src/sources/tencent-public-core.ts`：上提 `TENCENT_IFZQ_HOSTS` + host 冷却表；`tencent-http.ts` 改 import。
2. `src/sources/trend-series.ts`：目标解析（`thscode` + `asset_type` → `{source, symbol|secid}`）、两条取数与归一、截断规则。
3. `watchlist/index.js`：`/trend` 路由（认证、清单闸门、缓存、单飞、超时）。
4. `watchlist/client.src.cjs`：`useTrend` 取数、`IntradayChart` 组件、合并两块占位、i18n（zh/en 各一套新 key）。
5. `watchlist/client.js` 重建；`test/trend-fixtures.mjs` + 新增/同步的测试；`scripts/smoke-trend.mjs`。
6. 版本 2.27.0 + CHANGELOG + README 徽章 + tag。

---

## 8. 验收命令

```bash
npm run build                       # ts → lib，watchlist 客户端
node scripts/smoke-trend.mjs 600519.SH 00700.HK HSI.HK AAPL.OQ IXIC.US   # 真报文
npm test                            # watchlist 六套 + 新增 trend 套件
npm run check:dsh                   # 扩展面账本（本期应零变化）
```

手工核对（浏览器）：切换 5 行不排队卡死；上一交易日的标的挂日期胶囊；断网 → 块内错误 + 重试；
`.PS` 美股 → 明确"该市场暂无分时"。

复现本文数据：

```bash
curl -s 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519' -H 'Referer: https://gu.qq.com/'
curl -s 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=105.AAPL&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1'
```

---

## 9. 待拍板

| # | 问题 | 决定（2026-11-18） |
|---|---|---|
| D1 | 港股 16:08 收盘竞价点是否画进线里 | **画**（真实成交价）：序列末点因此与顶部官方最新价一致；tooltip 显示原始时刻，x 轴刻度仍写 16:00 |
| D2 | 是否要「1日 / 5日」切换 | **v0.1 不做**；要做就整体切到东财 `ndays=5`（同一源、同一时间轴），等 1 日这条线跑顺再上 |
| D3 | 成交量块并入图表 vs 保留独立块 | **并入**：价格区 + 成交量区在同一张 SVG 里，只剩一个块标题 |
| D4 | 是否把分时注册成模型工具 `get_intraday_trend` | **本期不做**；会动工具表与 132 条能力目录，属于另一个决策 |
| D5 | 列表行要不要迷你走势 | **不做**：一只一次请求，30 行撑不住 1 req/s 的链 |
| D6 | 美股 OTC（`.PS`）与冷门美股指数无图 | **接受**，空态写明"该市场暂无分时"，不发请求 |

---

## 10. 实现记录（2026-11-18）

落地清单与 §7 一致，另有五处是动工后才发现的，已在这里改正，稿子正文按实测更新：

1. **东财美股时间戳是北京时间**（首行 22:30、末行 05:00，对应纽约 09:30–16:00）。§2.2 原表把它当交易所钟点读，
   实现改成"先按 +08:00 还原瞬时、再按 `America/New_York` 换算"，交易日也取纽约日期；
   `test/watchlist-trend.test.mjs` 用"首行必须是 09:30"钉住这条。
2. **港股指数的盘后点不是收盘竞价**：`hk00700` 是 16:08 一个竞价打印，`hkHSI` 却是 18:31 一个夜间报价。
   判定收紧为"只补 16:00–16:10 之间那一个点"，指数因此停在 15:59/16:00，不会被 18:31 拉长。
3. **指数一律不给均价**（含东财）：东财指数行 `amount=0`，那一列是指数点位的钟均值，和个股 VWAP 不是一个量纲。
   这条把原稿 §3.2 表里"东财指数也给"改掉了。
4. **`useRef` 的测试桩原本不保留初值**（`() => ({current:null})`），导致异步回包在测试里被 `alive.current` 一律丢掉。
   桩改成 `(value) => ({current:value})`（与 React 一致），顺带让"选行→取数→出图"这条链路真正被测试覆盖。
5. **分时的请求序号放在模块级**（`deskTrendSequence`）而不是 `useRef`：测试里每次渲染都会新建 ref，
   序号会退化成 1，晚到的旧回包就盖住了新选中。工作台是单实例，模块级计数没有副作用。

做出来的图与 §4 的差异：均价线用实线蓝（`--dsw-alias-state-business-primary`）而不是虚线——SVG 在像素坐标下
虚线要按实测宽度调，先保清晰；其余元素（渐变面积、昨收虚线、成交量柱、十字光标、浮动读数）与稿子一致。

### 10.1 首版翻车：图表把自己越撑越大（2026-11-18，用户实测）

症状：打开工作台后，左侧清单与右侧详情的高度一起持续增长，像在不停加载。根因是两条叠加：

1. **SVG 参与了流式布局**。`<svg>` 只有 `width/height: 100%` 与一个 `viewBox`，在高度由内容的盒子里，
   浏览器按固有宽高比反推它的高度；`ResizeObserver` 把量到的 `clientHeight`（取整）写回 `viewBox`，
   宽高比随之变化，下一轮再反推——每帧放大一点点，稳不住。`clientWidth` 的取整是放大器。
2. **grid 的隐式行按内容自适应**。`.cwd-body` 只写了 `height`，行高仍是 `auto`，右栏一长高就把行撑开，
   左列 `height: 100%` 跟着一起高——所以用户看到的是"两栏一起长"。

修法（三条一起上，缺一条都可能复发）：

- `.cwd-chartsvg { position: absolute; inset: 0 }`：绝对定位的子树永远影响不了容器尺寸，物理上断开回路；
  同时 `.cwd-chartbox { overflow: hidden }` 兜住越界绘制。
- 量测改用 `getBoundingClientRect()`（带小数）+ **2px 死区** + 返回同一对象让 React 直接 bail out：
  亚像素抖动不再能驱动重渲染。
- `.cwd-body { grid-template-rows: minmax(0, 1fr) }`：行高钉死在 `--cwd-body-h`，右栏再怎么变高也只能
  在详情里滚动，不会把整行撑开。

回归断言在 `test/watchlist-client.test.mjs`：SVG 必须 `position: absolute`、图表盒必须 `overflow: hidden`、
`.cwd-body` 必须写 `grid-template-rows: minmax(0, 1fr)`。

### 10.2 第二版翻车：横轴按点数铺开，柱子被拉粗（2026-11-18，用户实测）

症状：开盘五分钟打开工作台，三四个点铺满整条横轴，成交量柱变成四根一二百像素宽的色块；
用户拿券商分时图对照问"难道不该是那样"。根因是把**点序号**当横坐标：

```js
const scaleX = (index) => left + (index / (points.length - 1)) * plotWidth   // 错
```

`points.length` 在盘中是个变量，10:00 有 30 个点、15:00 有 240 个点，同一时刻的同一根柱子宽度差 8 倍；
柱子宽度又取 `plotWidth / points.length`，于是"点越少柱越粗"。开盘时点最少、柱子最粗，正是用户看到的样子。

修法：横轴改成**交易时钟**，与到货点数无关。

- `TREND_SESSIONS` 给出各市场的交易时段（`a-share` `09:30-11:30`+`13:00-15:00` 等），
  `deskSessionOf()` 把午休压成零宽，于是"一个 slot = 一个交易分钟"，`total` 就是当日长度（A 股 240）。
- `deskSlotOf(分钟)` 把交易所本地时刻映射到 slot；落在时段外的打印（港股 16:08 收盘竞价）夹到边上，
  不再把横轴拉长。
- `scaleX(slot)` 只在 `slot / session.total` 上取比例；柱宽 = `slotWidth * 0.72`（下限 1px、上限 10px），
  一小时 60 根柱子跟到货点数无关。
- 刻度改成整段交易时间的半点网格 `deskTicksOf()`（09:30…15:00），落在同一 slot 的（11:30 与 13:00）
  只留前一个；竖网格线按同一套刻度画，午休边界单独一条虚线。图上没有数据的那段照样有轴——
  券商终端就是这个画法。

回归断言：`⛔ 横轴是交易时钟：09:32 的走势只占最左一窄条` 用三个点钉住三件事——折线最大 x 不超过
绘图区 3%（3/240）、柱子宽度落在 `[1, 一分钟]` 区间、`13:30`/`15:00` 刻度仍在。

顺带观察到的一件事：**分时数据在盘中就是稀疏的**，开盘四分钟只有四个点，图上理应是一条贴着左沿的细线。
"看起来像没画"是正确行为，不是空态。

### 10.3 第三版两处口径错：科创板量纲、详情头与分时不同源（2026-11-18，用户实测）

截图里两处「对不上」，其实是两个独立的问题。

**一、均价 0.09 —— 科创板的成交量是股，不是手。** 首版对 A 股一律按「手 = 100 股」换算：

```ts
const lot = target.market === 'a-share' ? 100 : 1      // 错：688xxx 不成立
```

实测同一时刻的原始报文（2026-11-18 10:31）：

| 代码 | 累计成交量 | 累计成交额 | 额/量 | 最新价 | 真单位 |
|---|---|---|---|---|---|
| `sh600519` | 8,864 | 1,284,914,477 | 144,958.76 | 1,449.96 | 手（×100） |
| `sh688599` | 11,691,404 | 108,811,239 | 9.31 | 9.24 | 股 |

东财/腾讯的成交额永远是元，所以「额 ÷ 量」本身就能说明单位：落在价格上就是股，落在价格 ×100 上就是手。
两个候选相差一百倍，取更近的那个不需要阈值，也不必维护板块表（688 之后还有 689 CDR、北交所）。
`trendLotSize()` 就是这么判的，`volume_unit` 随之在 `lot` / `share` 之间切换，成交量标签也从「万手」变成「万股」。
大盘指数不参与判定（指数点位不是成交均价），仍按手。

**二、两处时间对不上 —— 清单和分时是两份不同步的数据。** 清单的报价是打开面板时刷的（10:26），
右栏的分时是选中那一行时取的（10:29）。两块各自都诚实，并排放在一起就自相矛盾：大价格 9.24 / -2.43% 来自旧快照，
图上的 10:29 那点是 9.23 / -2.53%。修法不是「再刷一次报价」（多一次上游请求，仍然会错开），
而是**让详情头跟随更新的那一份**：分时就位且属于当前选中行时，大价格、涨跌幅、时间戳全部取自这份分时
（`(last - prev_close) / prev_close` 现算），「行情时间」显示分时的最后一点，A 股的「交易所时间」也由它补齐
（此前一直是横杠：Fuyao 的快照不回 `source_time`）。分时还没到位、或还在别的那只票上时，头退回上一份报价快照——
`⛔ 分时还是别的那只` 那条用例钉的就是这个回退。

清单里那一行也一起跟着：分时就位后，左侧这一行和右栏是同一份数据（`liveQuote()` 一处判断，列表行与详情头共用），
点开哪只、哪只才是活的，其余行仍是上次刷新时的报价——「看着的那只最鲜」比「一屏两个数」好解释。

时间也顺手收敛成一格。「快照时间 / 交易所时间」并排放在一起时，A 股与港股下它们是同一个值
（交易所钟就是本地钟），美股只差一个时区标签——一个永远重复旁边的格子比缺一格更糟。
现在只有一格「行情时间」：`session_date` + 分时最后一点，美股追加「美东」；没有分时的时候退回
抓取时刻（`captured_at`），此时它表示的是「我们什么时候请求的」，因此不给时区标签。
被删掉的 `desk.sourceTime` 是同一时刻的旧叫法，港美股报价的 `quote_time` 仍留在数据里不动。

单元格「快照时间」随之改称「行情时间」：它说的是「你正在看的这个数字是什么时候的」，不再是「我们什么时候请求的」。

## 11. 历史日 K（2026-11-18）

分时下面再接一块日 K。**数据不新写一份解析**：插件侧 `get_kline` 早就有腾讯 K 线的取数与行解析
（A 股 `appstock/app/fqkline/get`、港股 `hkfqkline`、美股 `usfqkline`，含宿主轮换与 `code` 校验），
这次只在 `tencent-http.ts` 里加一个窄口子：

```ts
fetchDailyBars({ thscode }, signal, count) → { adjust, bars, volume_unit }
```

它固定 `day` + `qfq`，一次请求，不翻页；`executeKline` / `executeOffshoreKline` 与两个行解析器
都是原有那几份，工作台不新增第二套 K 线解析（§9.7 的口径）。

### 11.1 量纲：日线没有成交额可以互证

分时那条用「累计成交额 ÷ 累计成交量」落在价格上判定手/股（§10.3）。日线的 A 股行只有六个字段
（`date, open, close, high, low, volume`），没有成交额，所以那条判据用不上。实测两个板块：

| 代码 | 11-17 单日量 | 价格量级 | 真实单位 |
|---|---|---|---|
| `sh600519` | 35,116 | 1,450 | 手（×100） |
| `sh688599` | 29,167,944 | 9.47 | 股 |

因此日线按板块判定：688/689 报股、其余报手，港股与美股一律按股。这条判据只影响界面上
「万股 / 万手」这一层与 tooltip，不影响蜡烛形状；它和分时那条结论对齐（同一只票两块图不会一个说手一个说股）。

### 11.2 画法

- 与分时共用同一套像素几何契约：绝对定位的 SVG、实测矩形 + 2px 死区、`min-height` 不参与反推。
  日 K 盒固定 `height: 300px`，**不用 flex:1**——旁边就是可滚动的详情列，flex + 内容自适应正是
  §10.1 那次把自己撑大的组合。
- 价格轴 5 格；成交量单独一格，柱高按窗口内最大量归一，柱色跟当天实体同色。
- 均线四条（5/10/20/60）：`--dsw-alias-label-primary` / `--state-warn-primary` / `--brand-primary` /
  `--label-tertiary`。30 日均线在 700px 宽里会和 20 日贴在一起，所以不做五条。
- 横轴只标月（第一格带年份）：120 根里逐日标会糊成一团。
- 指针悬停按「最近一根」取整，tooltip 给日期、收/涨跌幅（对前一根收盘）、开高低收与成交量。

### 11.3 边界

腾讯的 K 线入口只认 5 位港股代码与美股代码，不认指数：`HSI.HK` 在代码校验就被拒，
`IXIC.US` / `INX.US` 回无效节点。这两类直接给空态（`kline_unavailable` + `market_unsupported`），
不发请求、不画半张图。A 股指数（`000001.SH`、`399001.SZ`）走 `fqkline` 正常返回，与个股同一条路径。

### 11.4 第四版翻车：图盒压不下来，就压到下一块标题上（2026-11-18，用户实测）

症状：加了日 K 之后右栏出现滚动条，分时块的图还压住了下一块的「日K 前复权」标题。

根因和 §10.1 是同一族，但方向反过来：`.cwd-block-chart` 被 flex 分到 260px，而它的内容
（标题行 26 + 统计行 40 + 图盒 230）比 260 高；图盒用的是 `flex: 1` + `min-height: 230px`，
在内容超高的块里，`min-height` 让图盒拒绝变矮，块又是 `overflow: visible`，于是多出来的 30px
直接画在下一块上。§10.1 修的是"图把容器撑大"，这次是"容器缩小时图不肯让"。

修法：让两层都能缩。

- 两块图 `flex: 1 1 0` + 各自的最小高度（200 / 220），平分详情列的剩余高度；
- 图盒的 `min-height` 从 230 放到 120（日 K 从 300 放到 140），块的标题行 / 统计行 / 图例都
  `flex: none`——它们不参与压缩，被压的只有画布本身；
- 分时块加「收起 / 展开」：折叠态 `flex: none`，只留标题行，高度全给日 K。
- 详情区同时删掉「所属分组」一格（分组筛选器已经是入口），meta 收回一行。

回归断言：`.cwd-block-chart` / `.cwd-block-kline` 必须是 `flex: 1 1 0`，两个图盒的
`min-height` 必须小于所在块的最小高度（120 < 200、140 < 220），折叠后 `cwd-chartbox` 不再出现而
`cwd-klinebox` 仍在。

### 11.5 版面：先把重复的一行去掉，再把高度还给图

两张图挤在一列里，先别急着缩字号——先看哪些行是重复信息：

| 原来独立成行 | 后来并到哪 | 省下 |
|---|---|---|
| 行情时间 / 标的类型 | 价格右边的同一行（`.cwd-quoterow` 左侧报价、右侧 meta） | ~40px |
| 今开…成交额 六项 | 「当日分时」标题行（`.cwd-blockhead` 里跟着标题，窄了换行） | ~40px |
| MA5/10/20/60 图例 | 「日K」标题行，`前复权` 仍在右端 | ~22px |

省下来的高度在 `flex: 1 1 0` 的两块之间平分，同一窗口下每张图各高约 +60px。这三处各自的
断言写在 `⛔ 版面把高度优先给图` 里：meta 必须在 `.cwd-quoterow` 里、统计行必须是分时 head 的孩子、
图例必须是日K head 的孩子——一旦有人把它们拆回独立行，图又会变回"太小"。

### 11.6 高度不要猜：vh 换成面板的真实剩余高度

`--cwd-body-h: clamp(520px, 78vh, 860px)` 是对窗口高度的猜测，猜在两处：

- 猜小了（78vh 小于面板实际可用高度）→ 详情列内部出滚动条，两张图被压到最小高度；
- 猜大了（78vh + 页面内边距 > 面板）→ 整页出滚动条，卡片上下都被切掉。

两头的滚动条都来自同一个变量，所以不再猜：

```css
.cwd-page  { display: flex; flex-direction: column; height: 100%; }
.cwd-inner { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.cwd-body  { flex: 1 1 auto; min-height: 420px; max-height: 880px; }
```

面板有多高，卡片就有多高（上限 880px 免得超宽屏把卡片拉成一片空白）；两张图分的是真实剩余高度。
`min-height: 420px` 是兜底：窗口再小就让整页滚动，而不是把图压没。

同一次顺手把内层上下内边距从 28/44 收到 24/32——那 16px 也是从卷轴里省出来的。
