/**
 * 生成 docs/data-collector-capabilities.md（能力总表）。
 *
 * 为什么是脚本而不是手写：69 个端点的表格手工维护必然漂移。本脚本从
 * `src/sources/fuyao-rest.ts`、`src/sources/tencent-http.ts`、`src/sources/eastmoney-http.ts` 与 `src/sources/wind-mcp.ts` 的端点定义直接生成表格，`test/data-collector-capabilities.test.mjs`
 * 再断言"文档 == 实现"，于是新增端点忘了同步时会在测试里失败，而不是在文档里悄悄过期。
 *
 *   npm run docs:capabilities
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

const OUTPUT = fileURLToPath(new URL('../docs/data-collector-capabilities.md', import.meta.url))

const hub = new DataCollectorHub({ store: { async save() { throw new Error('unused') } } })
const sources = [...createFuyaoRestSources(async () => 'unused'), ...createTencentSources(), ...createEastmoneySources(), ...createWindSources(async () => 'unused')]
for (const source of sources) hub.registerSource(source)

const pathOf = (source) => source.schema.source_label === 'tencent'
  ? `/tencent/${source.schema.capability.replace(/^tencent_/, '')}`
  : source.schema.source_label === 'eastmoney'
    ? `/eastmoney/${source.schema.capability.replace(/^eastmoney_/, '')}`
    : source.schema.source_label === 'wind'
      ? `/wind/${source.schema.capability.replace(/^wind_/, '')}`
      : '/' + source.schema.data_key.replace('fuyao.api.', '').replace(/\./g, '/')

// 东财按主题拆成宏观、沪深港通、资金与筹码三张表：分组是各自 filter（不互斥），
// 所以通用组必须显式排除另两类的路径，否则一行会出现在两张表里。
const MACRO_PATHS = new Set(['/eastmoney/cpi', '/eastmoney/ppi', '/eastmoney/gdp', '/eastmoney/pmi', '/eastmoney/money_supply', '/eastmoney/rmb_loan', '/eastmoney/customs_trade', '/eastmoney/retail_sales', '/eastmoney/deposit_reserve'])
const MUTUAL_PATHS = new Set(['/eastmoney/mutual_flow', '/eastmoney/mutual_quota'])

const GROUPS = [
  ['元数据（代码表与消歧）', (p) => p.startsWith('/api/meta/')],
  ['A 股行情与公司行为', (p) => p.startsWith('/api/a-share/prices/') || p.startsWith('/api/a-share/calendar/') || p.startsWith('/api/a-share/corporate-actions/')],
  ['A 股财务', (p) => p.startsWith('/api/a-share/financials/')],
  ['估值与集合竞价', (p) => p.startsWith('/api/a-share/valuations/') || p.startsWith('/api/a-share/auction/')],
  ['盘面特色数据', (p) => p.startsWith('/api/a-share/special-data/')],
  ['指数', (p) => p.startsWith('/api/a-share-index/')],
  ['基金 · 基本资料与场内行情', (p) => p === '/api/fund/profile/detail' || p.startsWith('/api/fund/market/')],
  ['基金 · 业绩与净值', (p) => p.startsWith('/api/fund/performance/')],
  ['基金 · 持仓与配置', (p) => p.startsWith('/api/fund/portfolio/')],
  ['基金 · 持有人与管理人', (p) => p.startsWith('/api/fund/holders/') || p.startsWith('/api/fund/managers/') || p.startsWith('/api/fund/companies/')],
  ['基金 · 财务、指标与诊断', (p) => p.startsWith('/api/fund/financials/') || p.startsWith('/api/fund/indicators/') || p.startsWith('/api/fund/diagnostics/')],
  ['基金 · 分红、募集与额度', (p) => p.startsWith('/api/fund/corporate-actions/') || p.startsWith('/api/fund/offerings/') || p.startsWith('/api/fund/quota/')],
  ['基金 · 在线回测', (p) => p.startsWith('/api/fund/backtest/')],
  ['腾讯公开 HTTP（fallback）', (p) => p.startsWith('/tencent/')],
  ['东方财富 HTTP（沪深港通）', (p) => MUTUAL_PATHS.has(p)],
  ['东方财富 HTTP（宏观指标）', (p) => MACRO_PATHS.has(p)],
  ['东方财富 HTTP（资金与筹码）', (p) => p.startsWith('/eastmoney/') && !MACRO_PATHS.has(p) && !MUTUAL_PATHS.has(p)],
  ['Wind 金融数据服务（MCP）', (p) => p.startsWith('/wind/')],
]

const paramsOf = (source) => {
  const schema = source.schema.input_schema
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const names = Object.keys(schema.properties ?? {})
  if (names.length === 0) return '无参数'
  return names.map((name) => (required.has(name) ? '`' + name + '`\\*' : '`' + name + '`')).join(' ')
}

const L = []
L.push('# data_collector 能力总表')
L.push('')
L.push('> 本表由 `npm run docs:capabilities` 从 Fuyao、Tencent、Eastmoney 与 Wind source 定义生成，并由 `test/data-collector-capabilities.test.mjs` 断言与实现同步：新增端点若忘了重新生成，测试会失败。')
L.push('')
const fuyaoCount = sources.filter((source) => source.schema.source_label === 'fuyao').length
const tencentCount = sources.filter((source) => source.schema.source_label === 'tencent').length
const eastmoneyCount = sources.filter((source) => source.schema.source_label === 'eastmoney').length
const windCount = sources.filter((source) => source.schema.source_label === 'wind').length
L.push('当前共 **' + sources.length + ' 个 capability**：同花顺 Fuyao ' + fuyaoCount + ' 个，腾讯公开 HTTP ' + tencentCount + ' 个，东方财富 HTTP ' + eastmoneyCount + ' 个，Wind 金融数据服务 ' + windCount + ' 个。参数后带 **\\*** 表示必填。')
L.push('')
L.push('**复核方式**：Fuyao 能力可用 `npm run smoke:fuyao` 真实复核；Tencent 能力使用最小 smoke fixture 或按需真实请求复核；Eastmoney 能力使用固定 fixture，并按需执行公开网页 JSON smoke；Wind 能力用 `npm run smoke:wind` 真实复核（需要 `WIND_API_KEY`，**按次消耗上游积分**）。')
L.push('')
L.push('## 怎么用')
L.push('')
L.push('data_collector 是唯一持有结构化行情/财务数据入口的子 Agent，主 Agent 与用户都不直接接触原始数据：')
L.push('')
L.push('1. 主 Agent 通过 `subagent_data_collector` 委派需求（只传需求与参数，不传原始数据）。')
L.push('2. data_collector 按问题涉及的事实选能力，不设单回合数量上限；先调一次 `list_capabilities` 取回精简目录（一行一条 `capability|summary|paginated`），再逐个 `describe_capability` 核对 `input_schema` 与返回字段的逐行字典 `output_fields`，用 `request_data` 逐份取数。')
L.push('3. 宿主把上游原始数据**立即持久化**为不可变 Dataset（workspace 内、默认保留 7 天）；每份 DatasetRef（含缓存命中、分页的每页）由 collector 立即通知主 Agent，全部请求结束另发终结消息。原始行永不进入任何 Agent 的上下文；主 Agent 可在取下一份期间把已到的数据交给 data_junior。')
L.push('4. 需要看数据内容或基础统计时，由兄弟子 Agent `data_junior` 用 `describe_dataset` 完成 profile 与受控 query，回传 `profile_ref`。')
L.push('')
L.push('## 通用约定')
L.push('')
L.push('- **代码必须带市场后缀**：A 股 `600519.SH`、指数 `000300.SH` 或 `886042.TI`、基金 `025480.OF` 或 `510300.SH`。禁止自行拼接后缀，先用 `ticker_search` 消歧。')
L.push('- **时间戳**统一为毫秒级 Unix 时间戳（`Asia/Shanghai`）；日期字符串统一 `yyyy-MM-dd`。')
L.push('- **百分比口径不统一，引用前必须看 `describe_capability` 详情**：行情/财务/持仓类多为「百分数原值」（`8.88` 表示 8.88%），但龙虎榜的 `change` / `net_rate` 是小数形式，基金回测 `metrics` 的口径文档自相矛盾。')
L.push('- **Wind 来源按次计费**：Wind 那三条（宏观/行业/汇率 EDB 与按区间取的 K 线）每次真实取数都消耗上游积分，凭据缺失、限流与后端错误一律不自动重试；同一请求在缓存新鲜度内复用已落盘的 Dataset（宏观 6 小时、K 线 1 分钟）。')
L.push('- **Wind 的参数面按真报文逐档放开**（未验不注册在这里同样生效）：`wind_stock_kline` 的 `adjust` 只给 `none`/`qfq`——后复权实测是"以 afdate 为锚向未来放大"，锚取当日时历史逐位等于不复权（名字骗人），故拒绝；`period` 只放打过真报文的七档（1/5/15/30 分钟与日/周/月，60 分钟两次都挂到超时）；`count` 与 EDB 的 `observation`（"取最近 N 期"）实测语义与上游返回不一致，都不提供，只按日期区间取。')
L.push('- **`null` 一律不补零**：上游用 `null` 表示未披露或无数据，语义与 `0` 不同。')
L.push('- **金额单位多处文档未给出**（尤其基金各页），一律按原值转述，不擅自换算。')
L.push('- 参数在**入队前**完成规范化与校验（大小写、空白、逗号列表去重、区间/互斥/枚举），失败即本地报错，不发请求、不落盘。')
L.push('- 每个端点的完整说明（单位、可空性、时间与分页口径、已知上游缺口）都在 `describe_capability` 返回的 `description` 里。')
L.push('')
L.push('## 不在覆盖范围')
L.push('')
L.push('| 模块 | 原因 |')
L.push('|---|---|')
L.push('| A 股主力资金 `capital-flow/*` | 上游返回 `code=2004`：同花顺 AI 客户端专用，未开放外部接入 |')
L.push('| 高频动向 `high-frequency/*` | 同上（`code=2004`） |')
L.push('| 全市场 Parquet 导出 `dump/market-dumps/*` | 预签名链接 + Parquet 二进制，需独立的下载/落盘链路，本阶段不接入 |')
L.push('| 期货 `futures/*`、期权 `options/*` | 与本 preset 的产品定位不符（角色边界只覆盖股票/指数/基金），共 30 个端点主动排除。**注意**：`ticker_search` / `ticker_list` 仍可按官方契约检索 `futures` / `options` 代码（元数据域全量放开），但本 preset 不提供它们的行情/财务数据端点 |')
L.push('| 基金新闻 `fund/news/article-list` | 非结构化内容，已由 `web_retriever` 的检索能力覆盖 |')
L.push('| Wind 的自然语言工具（选股 / 档案 / 财务 / 事件 / 风险，bond 域与 `analytics_data` 同类） | 返回哪些列**由 `question` 的措辞决定**，同一问法换个说法就换一套列——输出契约无处锚定，护栏等于没有。数值需求走 `wind_edb_search` / `wind_edb_query` / `wind_stock_kline`，公告与新闻正文才用 NL 工具（在 `web_retriever` 的 `wind_docs_*`） |')
L.push('| Wind 行情指标截面 `get_stock_price_indicators` | 中文键快照，腾讯与东财同位能力已覆盖；`indexes` 没有可核对的指标集文档，口径无法验 |')
L.push('| Wind 基金 / 指数 / 债券 server 与 `analytics_data` | 与 Fuyao 重叠且未打真报文；`analytics_data` 实测连 `initialize` 都超时（不可用），不得用它伪装其他覆盖 |')
L.push('')

for (const [title, match] of GROUPS) {
  const group = sources.filter((source) => match(pathOf(source)))
  if (group.length === 0) continue
  L.push('## ' + title)
  L.push('')
  L.push('| capability | 端点 | 主要参数 | 分页 | 用途 |')
  L.push('|---|---|---|---|---|')
  for (const source of group) {
    const detail = hub.describeCapability(source.schema.capability)
    L.push('| `' + source.schema.capability + '` | `' + pathOf(source) + '` | ' + paramsOf(source) + ' | ' + (source.schema.paginated ? '是' : '否') + ' | ' + detail.summary + ' |')
  }
  L.push('')
}

writeFileSync(OUTPUT, L.join('\n'))
console.log(`已生成 ${OUTPUT.replace(process.cwd() + '/', '')}：${sources.length} 个 capability`)
