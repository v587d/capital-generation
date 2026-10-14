import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBudget } from './preset-rows.mjs'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

/**
 * 社区 skill 正文的取数与合规闸门。
 *
 * 为什么必须有这条：上游 skill 写给"什么工具都在手边"的宿主，正文里成规模地要求 Agent
 * **自己去 web search 取实时报价**，取不到就"打个 ⚠️ 警告后用训练记忆估一个"（InvestSkill 28 颗里
 * 27 颗带这段）。本插件的取数只有一个入口——主 Agent 委派 `data_collector` / `web_retriever`，
 * 原始 rows 不出工具层。工具面那道墙是真的（`src/agents/root-tool-policy.ts` 逐名 deny），
 * 但"用记忆里的数字继续分析"没有任何工具会拦：它纯靠正文文本，所以正文必须自己不带这条路。
 *
 * 因此接入前必须逐条审、不合规就地改掉（清单见 `docs/dev/selected-skills.md` §8.6）。
 * 这条测试钉的是**改完之后不许漂回去**：按 catalog 现算扫描面，新加一条 skill 立刻进扫描，
 * 重新按 commit 覆盖快照而未重做合规改写也会立刻红。
 *
 * 第五颗（marian2js/trading-skills）把同一族危险换了形态：它一处 `web search` 都不写，改成
 * `curl "…apikey=<FMP_API_KEY>"` 自己取数、`ask which supported provider` 向用户点选付费服务商、
 * `Do not fetch live data unless the user explicitly asks to pair this skill with …`（把委派之外的取数写成
 * 默认允许的条件分支）、"already shared usable access details"（在对话里认领凭据），
 * "For agents that support code execution … `skills/_lib/calculations.py`" 把计算推给能跑代码的宿主，
 * 另有一颗 `etoro` 教 Agent 采集券商凭据并真实下单（因此不进 catalog，也不进发布包）。
 * 所以下面按**词组族**加宽（六条 → 十二条），而不是只补回被改掉的那一句——§8.6 第 10 条的反证就打在新增这六条上。
 *
 * 第六颗（jwangkun/claude-for-financial-services-cn，A 股 63 颗）又把同一族摊成**全量**：63 份正文每份都带
 * 一节三档服务商阶梯（万得 Wind 带 `WIND_API_KEY` 与密钥申请 URL、同花顺 iFind 带 `IFIND_AUTH_TOKEN`、
 * AkShare 兜底）、```python 围栏里的伪工具调用、尾部统一的 `IFIND_DATA_SOURCE_MODE` 环境变量开关，
 * 以及把服务商名写死进引用格式的 `Source: AkShare, [date]`。本插件没有 shell（§1.6）、没有那些服务商的凭据
 * （密钥只进 credentials 域 §5），取数一律委派（§1.1），所以这一族的每一条都要进闸门。
 * 注意 `\bWind\b` / `\bChoice\b` 这种"按英文单词名"的写法**不能用**：测试把命中统计强制成 `gi`，
 * 于是 sector-analysis 里的"wind"（风电）与 fact-check、tax-lens 里的"choice"普通词都会被误判。
 * 服务商这一族改按**无歧义形状**扫：中文名（万得 / 慧博）、`Wind / Choice` 的阶梯形状、以及 iFind / AkShare
 * 这两个本身不成英文词的品牌名。第六颗另有许可侧的正向断言（Apache-2.0 §4(b) 的改动声明行）。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** [正则, 为什么不允许]。命中即失败，并点名该改成什么。 */
const FORBIDDEN = [
  [/web search/i, '把取数交给 Agent 自己浏览：本插件的检索只有一个入口（委派 web_retriever），改成"走宿主取数通道 / 角色分流的宿主里把标的、字段、as-of 日期写进委派 brief 交出去"'],
  [/\bcurl\b/i, '让 Agent 自己伸手取数或直接调接口：取数只有一个入口（委派 data_collector / web_retriever），且上游点名的 FMP／Polygon／TradingEconomics／券商凭据本插件一概没有——密钥只进 credentials 域（docs/dev/settings-config.md §5.2），不在对话里收'],
  [/code[\s-]execution/i, '把计算推给"能跑代码的宿主"：本插件的分析角色没有 shell（docs/dev/bash-gate.md §1.6），统计量交给宿主数据侧（委派 data_junior），少量数字在答复里把算式写出来'],
  [/ask which supported provider/i, '向用户点选外部付费数据服务商：本插件没有这些服务商的凭据，也不为它们开第二条取数口子'],
  [/fetch live/i, '把"分析角色自己去取实时数据"写成默认允许的条件分支（上游的句式是 `Do not fetch live data unless …`）：取数一律委派，改成"缺哪个字段就把标的、字段、as-of 日期写成 brief 交给宿主取数通道，用回来的继续、其余标为未知"'],
  [/pair this skill/i, '指望"和另一颗会取数的 skill 配对"来绕开委派：那颗未必在使用者开启的集合里，本插件的取数入口也只有委派这一个（docs/dev/selected-skills.md §8.6 第 1 条）'],
  [/usable access details/i, '以"对话里已经给过凭据"为由取数：凭据不进对话，取数一律委派（同上两条）'],
  [/Retrieval: model memory/i, '把"记忆"当成一种取数途径：出处块的 Retrieval 只能是真路径（delegated retrieval / web/tool retrieval / pasted by user）'],
  [/training[- ]data estimates/i, '允许用训练记忆估算值继续分析：本插件不接受回填数字，取不到就报缺'],
  [/Live data unavailable/i, '"打个警告然后照跑"的逃生口：改成点名缺哪些字段并停止该字段下的分析'],
  [/node scripts\/|bash scripts\//i, '指向上游脚本：脚本不进发布包、根角色也没有 shell，取数一律走委派'],
  [/host can(?:not)? fetch/i, '以"宿主能不能抓"分支：本插件的取数通道恒在（委派），只有"宿主完全没有检索路径"才谈用户粘贴'],
  // ↓ 第六颗那一族：正文自带的数据层（服务商阶梯、伪调用、模式开关、凭据形态）。
  //   反证（§8.6 第 10 条）打在下面这几条上：把任意一颗换回上游原文，只有这一族会红。
  [/```python/, '把取数写成一段看起来能跑的 python：本插件的取数入口只有委派一个（docs/dev/selected-skills.md §8.6 第 1 条），这些函数名指向的是上游那几个不随包发布的取数服务；改成"要哪些字段、as-of 哪天"的委派 brief'],
  [/\bmcp__[a-z_]+__\b/, '点名 MCP 工具名当取数途径：运行时不存在这些工具（上游服务端连发布包都不进），改成委派 brief 里写清标的、字段与 as-of 日期'],
  [/\bIFIND_DATA_SOURCE_MODE\b/, '留着一个环境变量决定"用哪家服务商"：取数档位由宿主的凭据域决定（docs/dev/settings-config.md §5.2），不在对话正文里配置，也不向使用者索取凭据'],
  [/\bWIND_API_KEY\b|\bIFIND_AUTH_TOKEN\b/, '正文出现凭据名：密钥只进 credentials 域（docs/dev/settings-config.md §5.2），分析正文一律不带'],
  [/\bak\.[a-z_]+\(/, '指向上游 SDK 的具体函数：本插件不跑代码取数（docs/dev/bash-gate.md §1.6），要那个字段就向宿主的数据通道要'],
  [/\bget_[a-z_]+\(/, '伪工具调用形状（`get_financials(ticker, …)` 一类）：运行时没有这些工具，取数一律委派，写成字段清单与 as-of 日期'],
  [/\bifind_[a-z_]+/, '点名付费服务商接口的函数名：本插件没有该服务商的凭据，也不为它开第二条取数口子'],
  [/密钥申请|aifinmarket/, '在正文里给使用者指路去申请数据服务密钥：凭据只进 credentials 域（docs/dev/settings-config.md §5.2），分析正文不引导开户'],
  [/\bAkShare\b|\bAkSource\b/, '把某家外部数据服务商写成取数途径：本插件的取数入口只有委派一个，服务商与密钥不归分析正文决定'],
  [/\biFind\b/, '同上：点名外部服务商作为数据档位（本颗用它而不写成"同花顺"，因为同花顺结构数据正是本插件在用的来源之一）'],
  [/万得|慧博|wind\s*\/\s*choice/i, '服务商阶梯（"哪家最全、付费/免费备选"）留在正文里：本插件不选服务商，取数一律委派；缺字段就点名并停止该字段的分析（§8.6 第 2 条）'],
  // ↓ 第七颗（financeskills）那一族：这批没有取数层，"把活儿推给运行时"写成了**代码与脚本**的形状。
  //   上面 `code[\s-]execution` 那条要求两个词连着写，所以 `**Build with code**`、`In code: a single
  //   CONFIG dict`、`with code-verified math` 全都不响；`node scripts/|bash scripts/` 只认那两个动词，
  //   所以产出物模板里 `Computed with scripts/calculate.py` 这一句运行时假话也不响；宿主工具名从来没
  //   进过模式表，所以 `**web_fetch … cannot access secure banking portals**` 也不响。三条一起补上，
  //   否则照 commit 重新覆盖快照时这六段会静默退回，而 `npm test` 照样全绿。
  //   误伤面实测过：三种形状在已收录 67 颗的正文里零命中（唯一两处撞在 InvestSkill 仓库级
  //   SECURITY.md / CLAUDE.md，那些不进扫描面）。
  [/\b(?:in|with) code\b|code-verified/i, '把计算推给"能跑代码"的运行时（`Build with code`、`Compute ratios with code`、`In code: a single CONFIG dict`、`code-verified math` 都是这一族）：根角色没有 shell（docs/dev/bash-gate.md §1.6），改成"照 references/ 的算式做、把算式写进答复、真要算力就委派 data_junior"'],
  [/\bwith scripts\/|\bvia scripts\//i, '产出物把数字归给"跑过的脚本"（模板脚注 `Computed with scripts/calculate.py` 一类）：脚本不进发布包、也没有一句话能让它跑起来，这是一句运行时假话。注意不要写成裸 `scripts/`——`## Scripts` 段本来就链接它并写明"没人会执行"'],
  [/\bweb_fetch\b/, '点名宿主工具名当取数或取证途径：本插件的检索只有一个入口（委派 web_retriever），且根角色的工具表里没有这颗工具。上游这句原意是护栏（"抓不到银行门户与企业内网"），改写时要保住护栏含义，别只把词换掉'],
  // ↓ 第八颗（Howard-Jerry/quant-agent-skills）带来的一族。这颗的违规形状不在措辞，而在**指挥一件
  //   公开版根本不存在的东西**：上游三颗 SKILL.md 点名的本地路径实测 10 / 32 / 16 个，公开仓里一个
  //   都没有（私有数据层要到 v1.1 才开源）。现有 26 条在这三颗上只响 1 次——第 10 条只认
  //   `node|bash scripts/`，而它写的是 `Use \`scripts/x.py\`` 和 `PYTHONPATH=… python data_platform/…`。
  //   下面四条加进来之前逐条量过误伤面：在已收录的正文里全部零命中（脚本记在
  //   docs/reference/external-skill-scan-2026-10.md 的第八颗一节）。特别地，
  //   `python3? <带路径的 .py>` 这种更宽的写法**不能当模式**——第一颗的
  //   `python3 scripts/framework.py` 是 NEEDS_FALLBACK 刻意放行的（它配了"没有 shell 时直接读
  //   references/"那句退路），把它一起挡掉等于削掉既有设计。§9.7 同一族：闸门要认的是真会漂回去的那一形。
  [/\{\{\s*QUANT_ROOT\s*\}\}|\bPYTHONPATH\s*=|(?:data_platform|auto_research|sleeve)\/[\w./-]+\.py/, '指向作者私有工作区的执行指令（`{{QUANT_ROOT}}`、`PYTHONPATH=… python data_platform/…`、`auto_research/*.py`）：那些脚本与目录不随包发布、上游自己也写明要等到 v1.1 才开源，Agent 照做只会撞一条跑不通的指令。改成"向宿主数据通道要哪些字段、as-of 哪天"的委派 brief（docs/dev/selected-skills.md §8.6 第 1、4 条）'],
  [/\b(?:use|run)\s+`?scripts\//i, '把取数或计算交给 `scripts/` 里的脚本（第八颗的主措辞是 `Use \`scripts/stock_tools.py\` via \`StockTools\``）：本插件的分析角色没有 shell（docs/dev/bash-gate.md §1.6），根角色也没有。第 10 条只认 `node|bash scripts/`，这一形从来没进过表。改成点名要哪个字段、交给谁算'],
  [/\bcollect-data\b/, '指向上游的自建采集层（那句"所有 DB 和 API 数据采集必须通过 collect-data 完成，禁止绕过"）：本插件的取数入口只有委派 data_collector / web_retriever 一个，自建的第二条通道与"原始 rows 永不出工具层"直接冲突（§1.1、§8.6 第 1 条）'],
  [/五文件|三地沉淀/, '把结论落成一包文件（上游的 `README.md / 深度研究.md / 财务数据.md / 研报索引.md / 跟踪框架.md` 五文件包，以及"三地沉淀"里往个人知识库同步那一地）：报告交付链路 2026-09-17 已整条删除且禁止恢复（AGENTS.md §7），结论、证据、来源与局限一律写在最终答复里'],
]

/** 出现即要求同一文件里必须同时存在的退路说明。 */
const NEEDS_FALLBACK = [
  [/python3 scripts\//, /skip the router/, '脚本路由器指令必须配一句"没有 shell 时直接读 references/ 对应文件"，否则根角色会撞死在一条跑不通的指令上'],
]

const skillDocs = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((item) => item.isDirectory() ? skillDocs(join(dir, item.name)) : [join(dir, item.name)])
  .filter((file) => file.endsWith('.md'))

/**
 * 扫描面 = 每颗 catalog skill 目录下的**全部 .md**，不只是 `SKILL.md`。
 * 第四颗（peter-lynch-skill）把这条扩了：入口改干净之后，真正把 Agent 指回自行浏览的那一句
 * 住在 `references/deep/system-prompt.md`，只扫入口等于没扫——AGENTS.md §9.7 同一个族，
 * 闸门必须覆盖"运行时真会被读到的那一层"（CONTRIBUTING.md §4：附属文件与 SKILL.md 同属运行时正文）。
 */
const skills = SELECTED_SKILL_CATALOG.map((entry) => {
  const dir = join(ROOT, 'selected-skills', entry.repository, SELECTED_SKILL_SKILL_DIRS[entry.repository], entry.name)
  return { entry, dir, path: join(dir, 'SKILL.md'), files: existsSync(dir) ? skillDocs(dir) : [] }
})

const where = ({ entry, dir }, file) => `${entry.repository}/${entry.name}/${file.slice(dir.length + 1)}`

/**
 * 已按「入口册 + 分册 + 运行时 `read`」分层的 catalog 条目（这份清单只准变长）。
 *
 * `chars` 是该条目目录下全部 `.md` 的字符总量基线：分层的唯一许可是**搬家**，所以基线只准涨。
 * `cards` 是卡片 ID 的应有色数（没有卡片结构的条目不填）。
 * 登记进来就必须整棵树达标：目录下**任何** `.md`（含子目录）都不许再是厚册——只把入口
 * 削薄而留着上游自带的第二层厚指南，等于把剪枝再往下挪一层（`peter-lynch-skill` 就是这种形状：
 * 入口之外还有 4 份 8,750–21,342 的指南，各切成多册并把原路径留成索引）。
 */
const LAYERED = [
  { name: 'buffett-investment-framework', chars: 117909, cards: 65 },
  { name: 'china-idea-generation', chars: 9385 },
  { name: 'china-sector-overview', chars: 9523 },
  { name: 'china-catalyst-calendar', chars: 10512 },
  { name: 'bear-case', chars: 15218 },
  { name: 'stock-screener', chars: 12961 },
  { name: 'peter-lynch-skill', chars: 85955 },
]

/**
 * 宿主 `read` 的回执形状，与 `@deepseek-ai/dsh-tool-fs` 的 `formatReadOutput` 同形：每一行前面
 * 是 `N: `，再包 `<path>…</path>` / `<type>file</type>` / `<content>` 与结尾"total N lines"那行。
 *
 * ⛔ 所以"这一册会不会被剪"看的是**渲染后**的长度，不是文件字符数——2026-10-14 实测：
 * 7,302 字符 / 95 行的正文，read 回执 7,894 字符（差 592，几乎全是行号与标签）。
 * 拿文件字符数当上限，会放过真会被剪的册子，症状与不分层一样。
 * 路径长度按安装后的位置取：本机三种安装路径实测 178–184 字符，这里取 200 留余量。
 */
const READ_PATH_CHARS = 200
const readEnvelopeChars = (text) => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const body = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
  return [...`<path>${'x'.repeat(READ_PATH_CHARS)}</path>\n<type>file</type>\n<content>\n`
    + `${body}\n\n(End of file - total ${lines.length} lines)\n</content>`].length
}

/**
 * 正文里点名过的文件：markdown 链接保留**原样路径**，裸 `` `xxx.md` `` 按文件名匹配。
 * 入口册的分派列用裸名（每个链接省 20 字符），两种写法都得认——只认一种等于放行断链。
 * 寻址按宿主的教法：相对 skill 目录解析（`references/deep/…` 这类嵌套路径要能走通）。
 */
const mentionedTargets = (text) => new Set([
  ...[...text.matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/`([^`\s]+\.md)`/g)].map((m) => m[1]),
])
const resolveTarget = (skill, file, target) => (target.includes('/')
  ? [join(skill.dir, target), join(dirname(file), target)]
  : [join(dirname(file), target), join(skill.dir, 'references', target), join(skill.dir, target)]).find((p) => existsSync(p))
const realTargets = (skill) => {
  const found = new Set()
  for (const file of skill.files) for (const target of mentionedTargets(readFileSync(file, 'utf8'))) {
    const hit = resolveTarget(skill, file, target)
    if (hit !== undefined) found.add(hit)
  }
  return found
}

test('内容闸门：分层条目的每一册、无论走 skill 还是 read，都必须一次加载全文带回', () => {
  // 分层的意义就是"每一册都完整可见"：入口册达标了、分册照样超阈值的话，剪枝只是从 skill
  // 结果挪到 read 结果上，静默节选的问题一个都没解决。
  // 两条通道的上限不同：`skill` 的回执还要再包一层（≈512，见 loadBudget），所以正文上限是
  // threshold − 512；`read` 的回执就是 readEnvelopeChars 算出来那一段本身，没有额外包装，
  // 上限是 threshold。**不加人为 slack**——贴线多少字符要如实报出来（同 persona 那三道闸门）。
  const { thresholdChars, visibleChars } = loadBudget()
  for (const layer of LAYERED) {
    const skill = skills.find(({ entry }) => entry.name === layer.name)
    assert.ok(skill, `分层清单里的 ${layer.name} 不在 catalog：要么登记回来，要么把它从分层清单删掉`)
    const over = []
    for (const file of skill.files) {
      const text = readFileSync(file, 'utf8')
      const viaRead = readEnvelopeChars(text)
      if (viaRead > thresholdChars) over.push(`${where(skill, file)} 被 read 打开：回执 ${viaRead} > ${thresholdChars}`)
      if (file.endsWith('SKILL.md')) {
        const viaSkill = [...text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')].length
        if (viaSkill > visibleChars) over.push(`${where(skill, file)} 被 skill 加载：正文 ${viaSkill} > ${visibleChars}（阈值减渲染包装）`)
      }
    }
    assert.deepEqual(over, [],
      `${layer.name} 分层后仍有册超过一次加载的可见上限：再切一册，`
      + '不要留着一本厚册指望模型自己翻页（它只会在回执里看到 [middle pruned]，使用者看不到）。')
    const broken = []
    for (const file of skill.files) {
      for (const target of mentionedTargets(readFileSync(file, 'utf8'))) {
        if (resolveTarget(skill, file, target) !== undefined) continue
        broken.push(`${where(skill, file)} → ${target}`)
      }
    }
    assert.deepEqual(broken, [], `${layer.name} 点名了不存在的册：分层后册名是运行时唯一的寻址依据，点错一个等于那一册不在场`)
    const targets = realTargets(skill)
    // 入口册自己不算分册：它是 skill 工具的加载对象，不需要谁指过去。
    const orphans = skill.files.filter((file) => !file.endsWith('SKILL.md') && !targets.has(file))
    assert.deepEqual(orphans.map((file) => where(skill, file)), [],
      `${layer.name} 有没人指过去的册：写进目录而没有任何入口指针的附件，模型永远读不到`)
  }
})

test('内容闸门：分层只搬家——总量只准涨，卡片不重不漏，文件名声明的区间要与内容一致', () => {
  for (const layer of LAYERED) {
    const skill = skills.find(({ entry }) => entry.name === layer.name)
    assert.ok(skill, `分层清单里的 ${layer.name} 不在 catalog`)
    const total = skill.files.reduce((sum, file) => sum + [...readFileSync(file, 'utf8')].length, 0)
    assert.ok(total >= layer.chars,
      `${layer.name} 目录下 .md 总量 ${total} < 分层当天基线 ${layer.chars}：分层不许夹带删规则（§8.3 不准删断言变绿的同源纪律）`)
    if (layer.cards === undefined) continue
    const ids = skill.files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/^### ([A-Z]\d\d) —/gm)].map((m) => m[1]))
    assert.equal(new Set(ids).size, layer.cards,
      `${layer.name} 的卡片应有色数 ${layer.cards} 张、实际去重后 ${new Set(ids).size} 张（含重复 ${ids.length - new Set(ids).size} 处）：`
      + '同一张卡出现在两册迟早漂成两个版本，少一张就是搬家搬丢了')
    for (const file of skill.files) {
      const declared = basename(file).match(/([A-Z]\d\d)-([A-Z]\d\d)\.md$/)
      if (declared === null) continue
      const own = [...readFileSync(file, 'utf8').matchAll(/^### ([A-Z]\d\d) —/gm)].map((m) => m[1])
      assert.equal(`${own[0]}-${own.at(-1)}`, `${declared[1]}-${declared[2]}`,
        `${where(skill, file)} 的册名写着 ${declared[1]}–${declared[2]}、实际是 ${own[0]}–${own.at(-1)}：`
        + '入口册靠册名判断该开哪一册，名字与内容不符就是让模型按错地图走路')
    }
  }
})

test('内容闸门：扫描面跟着 catalog 走，且不是空断言', () => {
  assert.ok(skills.length >= 30, `catalog 只有 ${skills.length} 条，这道闸门接近空断言`)
  for (const { entry, path } of skills) {
    assert.ok(existsSync(path), `catalog 条目 ${entry.key} 找不到正文：${path}`)
  }
})

test('内容闸门：正文不许要求 Agent 自行取数、回填记忆或指向上游脚本', () => {
  for (const skill of skills) {
    for (const file of skill.files) {
      const text = readFileSync(file, 'utf8')
      for (const [pattern, why] of FORBIDDEN) {
        const hits = [...text.matchAll(new RegExp(pattern.source, 'gi'))].map((m) => m[0])
        assert.deepEqual(hits, [],
          `${where(skill, file)} 里还有「${[...new Set(hits)].join('、')}」——${why}。`
          + `（快照正文可以改，但必须逐条记进该快照的 UPSTREAM.md，见 docs/dev/selected-skills.md §8.6）`)
      }
      for (const [trigger, fallback, why] of NEEDS_FALLBACK) {
        if (trigger.test(text)) {
          assert.ok(fallback.test(text), `${where(skill, file)}：${why}`)
        }
      }
    }
  }
})

test('内容闸门：出处块点名的 Retrieval 取值必须包含委派这一档', () => {
  // 只查"写了 Retrieval 枚举"的文件：上游那套 `Data & Sources` 模板是每条 skill 的硬要求，
  // 枚举里没有委派档，就等于把"谁来取数"这个问题重新抛给模型。
  for (const skill of skills) {
    for (const file of skill.files) {
      const text = readFileSync(file, 'utf8')
      const enumLine = text.match(/^\s*Retrieval:\s*<(.+)>$/m)
      if (enumLine === null) continue
      assert.ok(/delegated retrieval/.test(enumLine[1]),
        `${where(skill, file)} 的 Retrieval 枚举缺 delegated retrieval：${enumLine[1]}`)
    }
  }
})

test('内容闸门：第六颗快照里被改写的正文必须各带一行 Apache-2.0 §4(b) 声明', () => {
  // 前五份是 MIT：再分发不要求在**被改的那份文件上**留痕，改动口径只住在 UPSTREAM.md 里就够了。
  // Apache-2.0 第 4(b) 条不同——它要求"修改过的文件带上显著的声明"。所以这颗快照里凡与上游不同的正文，
  // 正文第一行都得有一句可见声明指回该快照的 UPSTREAM.md。这一条不像取数那族会顺带撞别的断言，
  // 漏了没人响，所以单独钉住：漏一颗就点名那一颗。
  // 分层（§8.6 第三个改写理由）之后**每一册都算被改写的正文**，所以问的是目录下全部 .md，
  // 不只是 SKILL.md——只查入口册的话，新搬出去的分册就是这条义务的漏检面（AGENTS.md §9.7 同一族）。
  const sixth = skills.filter(({ entry }) => entry.repository === 'claude-for-financial-services-cn')
  assert.ok(sixth.length > 0, 'catalog 里没有第六颗快照的条目，这条闸门会退化成空断言')
  for (const skill of sixth) {
    for (const file of skill.files) {
      assert.match(readFileSync(file, 'utf8'), /^> 本文件相对上游 `d7585ca` 快照做过合规改写/m,
        `${where(skill, file)} 缺 §4(b) 的改动声明行（一级标题前那一句可见声明，指回快照根的 UPSTREAM.md）`)
    }
  }
})
