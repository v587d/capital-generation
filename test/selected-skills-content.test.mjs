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
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** [正则, 为什么不允许]。命中即失败，并点名该改成什么。 */
const FORBIDDEN = [
  [/web search/i, '把取数交给 Agent 自己浏览：本插件的检索只有一个入口（委派 web_retriever），改成"走宿主取数通道 / 角色分流的宿主里把标的、字段、as-of 日期写进委派 brief 交出去"'],
  [/Retrieval: model memory/i, '把"记忆"当成一种取数途径：出处块的 Retrieval 只能是真路径（delegated retrieval / web/tool retrieval / pasted by user）'],
  [/training[- ]data estimates/i, '允许用训练记忆估算值继续分析：本插件不接受回填数字，取不到就报缺'],
  [/Live data unavailable/i, '"打个警告然后照跑"的逃生口：改成点名缺哪些字段并停止该字段下的分析'],
  [/node scripts\/|bash scripts\//i, '指向上游脚本：脚本不进发布包、根角色也没有 shell，取数一律走委派'],
  [/host can(?:not)? fetch/i, '以"宿主能不能抓"分支：本插件的取数通道恒在（委派），只有"宿主完全没有检索路径"才谈用户粘贴'],
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
