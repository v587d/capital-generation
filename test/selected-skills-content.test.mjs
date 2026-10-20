import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBudget } from './preset-rows.mjs'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

// Community skill body gates. Upstream bodies tell the agent to fetch live data itself or fall
// back to training memory; this plugin delegates all retrieval, so catalog skills are scanned
// and rewritten. The patterns also cover provider staircases, script/code execution and
// private paths, and must keep rewritten snapshots from drifting back.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// [pattern, why forbidden]; a hit fails and names the required rewrite.
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
  // Sixth snapshot's embedded data layer: provider ladder, pseudo-calls, mode switch, keys.
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
  // Seventh snapshot phrases delegation avoidance as code/script execution and host tool names.
  [/\b(?:in|with) code\b|code-verified/i, '把计算推给"能跑代码"的运行时（`Build with code`、`Compute ratios with code`、`In code: a single CONFIG dict`、`code-verified math` 都是这一族）：根角色没有 shell（docs/dev/bash-gate.md §1.6），改成"照 references/ 的算式做、把算式写进答复、真要算力就委派 data_junior"'],
  [/\bwith scripts\/|\bvia scripts\//i, '产出物把数字归给"跑过的脚本"（模板脚注 `Computed with scripts/calculate.py` 一类）：脚本不进发布包、也没有一句话能让它跑起来，这是一句运行时假话。注意不要写成裸 `scripts/`——`## Scripts` 段本来就链接它并写明"没人会执行"'],
  [/\bweb_fetch\b/, '点名宿主工具名当取数或取证途径：本插件的检索只有一个入口（委派 web_retriever），且根角色的工具表里没有这颗工具。上游这句原意是护栏（"抓不到银行门户与企业内网"），改写时要保住护栏含义，别只把词换掉'],
  // Eighth snapshot points at private scripts; the broad `python3 *.py` form stays allowed because
  // the first snapshot's router is deliberately paired with a no-shell fallback.
  [/\{\{\s*QUANT_ROOT\s*\}\}|\bPYTHONPATH\s*=|(?:data_platform|auto_research|sleeve)\/[\w./-]+\.py/, '指向作者私有工作区的执行指令（`{{QUANT_ROOT}}`、`PYTHONPATH=… python data_platform/…`、`auto_research/*.py`）：那些脚本与目录不随包发布、上游自己也写明要等到 v1.1 才开源，Agent 照做只会撞一条跑不通的指令。改成"向宿主数据通道要哪些字段、as-of 哪天"的委派 brief（docs/dev/selected-skills.md §8.6 第 1、4 条）'],
  [/\b(?:use|run)\s+`?scripts\//i, '把取数或计算交给 `scripts/` 里的脚本（第八颗的主措辞是 `Use \`scripts/stock_tools.py\` via \`StockTools\``）：本插件的分析角色没有 shell（docs/dev/bash-gate.md §1.6），根角色也没有。第 10 条只认 `node|bash scripts/`，这一形从来没进过表。改成点名要哪个字段、交给谁算'],
  [/\bcollect-data\b/, '指向上游的自建采集层（那句"所有 DB 和 API 数据采集必须通过 collect-data 完成，禁止绕过"）：本插件的取数入口只有委派 data_collector / web_retriever 一个，自建的第二条通道与"原始 rows 永不出工具层"直接冲突（§1.1、§8.6 第 1 条）'],
  [/五文件|三地沉淀/, '把结论落成一包文件（上游的 `README.md / 深度研究.md / 财务数据.md / 研报索引.md / 跟踪框架.md` 五文件包，以及"三地沉淀"里往个人知识库同步那一地）：报告交付链路 2026-09-17 已整条删除且禁止恢复（AGENTS.md §7），结论、证据、来源与局限一律写在最终答复里'],
]

// A trigger that also requires a fallback sentence in the same file.
const NEEDS_FALLBACK = [
  [/python3 scripts\//, /skip the router/, '脚本路由器指令必须配一句"没有 shell 时直接读 references/ 对应文件"，否则根角色会撞死在一条跑不通的指令上'],
]

const skillDocs = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((item) => item.isDirectory() ? skillDocs(join(dir, item.name)) : [join(dir, item.name)])
  .filter((file) => file.endsWith('.md'))

// Scan every .md under each catalog skill, not just SKILL.md: references are runtime text too.
const skills = SELECTED_SKILL_CATALOG.map((entry) => {
  const dir = join(ROOT, 'selected-skills', entry.repository, SELECTED_SKILL_SKILL_DIRS[entry.repository], entry.name)
  return { entry, dir, path: join(dir, 'SKILL.md'), files: existsSync(dir) ? skillDocs(dir) : [] }
})

const where = ({ entry, dir }, file) => `${entry.repository}/${entry.name}/${file.slice(dir.length + 1)}`

// Entries split into entry/part files. chars is the total .md baseline and may only grow
// (layering is a move, not an edit); cards is the expected unique card count.
const LAYERED = [
  { name: 'buffett-investment-framework', chars: 117909, cards: 65 },
  { name: 'china-idea-generation', chars: 9385 },
  { name: 'china-sector-overview', chars: 9523 },
  { name: 'china-catalyst-calendar', chars: 10512 },
  { name: 'bear-case', chars: 15218 },
  { name: 'stock-screener', chars: 12961 },
  { name: 'peter-lynch-skill', chars: 85955 },
  { name: 'stock-eval', chars: 34135 },
  { name: 'technical-analysis', chars: 33656 },
  { name: 'dividend-analysis', chars: 33200 },
  { name: 'tax-lens', chars: 32972 },
  { name: 'stock-valuation', chars: 31829 },
  { name: 'position-ladder', chars: 30026 },
  { name: 'fact-check', chars: 29102 },
  { name: 'options-analysis', chars: 28548 },
  { name: 'sector-analysis', chars: 28029 },
  { name: 'competitor-analysis', chars: 27449 },
  { name: 'etf-analysis', chars: 25656 },
  { name: 'earnings-preview', chars: 25486 },
  { name: 'learning-coach', chars: 25342 },
  { name: 'financial-report-analyst', chars: 24638 },
  { name: 'institutional-ownership', chars: 23944 },
  { name: 'thesis-tracker', chars: 22712 },
  { name: 'risk-stress-test', chars: 22220 },
  { name: 'portfolio-review', chars: 22431 },
  { name: 'short-interest', chars: 21668 },
  { name: 'industry-map', chars: 20206 },
  { name: 'economics-analysis', chars: 19438 },
  { name: 'insider-trading', chars: 19152 },
  { name: 'catalyst-calendar', chars: 18360 },
  { name: '10k-digest', chars: 17931 },
  { name: 'earnings-call-analysis', chars: 16873 },
]

// Host read envelope (dsh-tool-fs formatReadOutput): line-number prefixes plus path/type
// tags. Pruning sees this rendered length, not the file size. Path budget 240 covers installed
// layouts; dev symlinks are shorter and would mask failures.
const READ_PATH_CHARS = 240
const readEnvelopeChars = (text) => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const body = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
  return [...`<path>${'x'.repeat(READ_PATH_CHARS)}</path>\n<type>file</type>\n<content>\n`
    + `${body}\n\n(End of file - total ${lines.length} lines)\n</content>`].length
}

// Referenced files appear as links or bare `xxx.md`; both forms count and resolve from the skill dir.
// Distinguish part addresses (bare name or references/...) from output paths such as
// `<TICKER>-10k-digest.md`, which are examples, not links.
const isPartAddress = (target) => !/[<>]/.test(target) && (!target.includes('/') || /^(?:\.\/)?references\//.test(target))
const mentionedTargets = (text) => new Set([
  ...[...text.matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => m[1]).filter(isPartAddress),
  ...[...text.matchAll(/`([^`\s]+\.md)`/g)].map((m) => m[1]).filter(isPartAddress),
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
  // Both channels must return full text: skill output adds ~512 chars of wrapper
  // (loadBudget), read has none. No artificial slack.
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
      } else if ([...text].length > visibleChars) {
        // bash cat omits line numbers but the pruner still counts the total, so hold it to
        // the skill-channel limit.
        over.push(`${where(skill, file)} 原文件 ${[...text].length} > ${visibleChars}（bash cat 通道没有行号包装）`)
      }
    }
    assert.deepEqual(over, [],
      `${layer.name} 分层后仍有册超过一次加载的可见上限：再切一册，`
      + '不要留着一本厚册指望模型自己翻页（它只会在回执里看到 [middle pruned]，使用者看不到）。')
    const discipline = readFileSync(join(skill.dir, 'SKILL.md'), 'utf8')
    assert.match(discipline, /no line window/,
      `${layer.name} 的入口册没有"整册开、不许用行窗口"那句：真机实测（2026-10-15）它会读 18–45 行`
      + '然后说"我打开了这一册"，规则的分层纪律就是从这句话开始塌的')
    assert.match(discipline, /Loading this file is not reading/,
      `${layer.name} 的入口册缺反谎报那句（加载入口不等于读过本 skill）`)
    const broken = []
    for (const file of skill.files) {
      for (const target of mentionedTargets(readFileSync(file, 'utf8'))) {
        if (resolveTarget(skill, file, target) !== undefined) continue
        broken.push(`${where(skill, file)} → ${target}`)
      }
    }
    assert.deepEqual(broken, [], `${layer.name} 点名了不存在的册：分层后册名是运行时唯一的寻址依据，点错一个等于那一册不在场`)
    const targets = realTargets(skill)
    // SKILL.md is the loaded entry, not a part that needs an inbound pointer.
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
  // Only files that declare a Retrieval enum; it must include delegated retrieval.
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
  // Apache-2.0 §4(b) requires a visible change notice in each modified file. After layering,
  // every part counts as modified, so all .md files are checked, not just SKILL.md.
  const sixth = skills.filter(({ entry }) => entry.repository === 'claude-for-financial-services-cn')
  assert.ok(sixth.length > 0, 'catalog 里没有第六颗快照的条目，这条闸门会退化成空断言')
  for (const skill of sixth) {
    for (const file of skill.files) {
      assert.match(readFileSync(file, 'utf8'), /^> 本文件相对上游 `d7585ca` 快照做过合规改写/m,
        `${where(skill, file)} 缺 §4(b) 的改动声明行（一级标题前那一句可见声明，指回快照根的 UPSTREAM.md）`)
    }
  }
})
