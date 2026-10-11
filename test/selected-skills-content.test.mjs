import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const sixth = skills.filter(({ entry }) => entry.repository === 'claude-for-financial-services-cn')
  assert.ok(sixth.length > 0, 'catalog 里没有第六颗快照的条目，这条闸门会退化成空断言')
  for (const { entry, path } of sixth) {
    assert.match(readFileSync(path, 'utf8'), /^> 本文件相对上游 `d7585ca` 快照做过合规改写/m,
      `${entry.name}/SKILL.md 缺 §4(b) 的改动声明行（一级标题下那一句可见声明，指回快照根的 UPSTREAM.md）`)
  }
})
