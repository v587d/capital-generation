/**
 * 生成 docs/data-collector-capabilities.md（能力总表）。
 *
 * 为什么是脚本而不是手写：61 个端点的表格手工维护必然漂移。本脚本从
 * `src/sources/fuyao-rest.ts` 的端点定义直接生成表格，`test/data-collector-capabilities.test.mjs`
 * 再断言"文档 == 实现"，于是新增端点忘了同步时会在测试里失败，而不是在文档里悄悄过期。
 *
 *   npm run docs:capabilities
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

const OUTPUT = fileURLToPath(new URL('../docs/data-collector-capabilities.md', import.meta.url))

const hub = new DataCollectorHub({ store: { async save() { throw new Error('unused') } } })
const sources = createFuyaoRestSources(async () => 'unused')
for (const source of sources) hub.registerSource(source)

const pathOf = (source) => '/' + source.schema.data_key.replace('fuyao.api.', '').replace(/\./g, '/')

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
L.push('> 本表由 `npm run docs:capabilities` 从 `src/sources/fuyao-rest.ts` 的端点定义生成，并由 `test/data-collector-capabilities.test.mjs` 断言与实现同步：新增端点若忘了重新生成，测试会失败。')
L.push('')
L.push('当前共 **' + sources.length + ' 个 capability**，全部来自同花顺 Fuyao 开放平台（`source_label: fuyao`）。参数后带 **\\*** 表示必填。')
L.push('')
L.push('**复核方式**：`npm run smoke:fuyao` 会对全部已注册 capability 发真实请求，逐条报告上游 `code` 与输出护栏判定（不打印密钥、不落盘响应数据）。')
L.push('')
L.push('## 怎么用')
L.push('')
L.push('data_collector 是唯一持有结构化行情/财务数据入口的子 Agent，主 Agent 与用户都不直接接触原始数据：')
L.push('')
L.push('1. 主 Agent 通过 `subagent_data_collector` 委派需求（只传需求与参数，不传原始数据）。')
L.push('2. data_collector 先调一次 `list_capabilities` 取回**能力目录**（capability + 一行摘要 + 是否分页），再对要用的能力调一次 `describe_capability` 取回 `input_schema`，最后用 `request_data` 取数。')
L.push('3. 宿主把上游原始数据**立即持久化**为不可变 Dataset（workspace 内、默认保留 7 天），工具只回传 `DatasetRef` 元数据；原始行永不进入任何 Agent 的上下文。')
L.push('4. 需要看数据内容或基础统计时，由兄弟子 Agent `data_junior` 用 `inspect_dataset` / `profile_dataset` 完成，回传 `profile_ref`。')
L.push('')
L.push('## 通用约定')
L.push('')
L.push('- **代码必须带市场后缀**：A 股 `600519.SH`、指数 `000300.SH` 或 `886042.TI`、基金 `025480.OF` 或 `510300.SH`。禁止自行拼接后缀，先用 `ticker_search` 消歧。')
L.push('- **时间戳**统一为毫秒级 Unix 时间戳（`Asia/Shanghai`）；日期字符串统一 `yyyy-MM-dd`。')
L.push('- **百分比口径不统一，引用前必须看 `describe_capability` 详情**：行情/财务/持仓类多为「百分数原值」（`8.88` 表示 8.88%），但龙虎榜的 `change` / `net_rate` 是小数形式，基金回测 `metrics` 的口径文档自相矛盾。')
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
