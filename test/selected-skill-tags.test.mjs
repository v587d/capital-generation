import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SELECTED_SKILL_CATALOG,
  SELECTED_SKILL_TAGS,
  SELECTED_SKILL_TAG_AXES,
  SELECTED_SKILL_TAG_LABELS,
  SELECTED_SKILL_TASK_IDS,
  SELECTED_SKILL_FALLBACK_TASK,
  SELECTED_SKILLS_MAX_ENABLED,
  fallbackOnlySkillNames,
  selectedSkillsForTask,
  taggedTaskSkills,
  taskSkillTags,
} from '../selected-skills/catalog.js'

/**
 * 标签注册表是**索引与筛选的唯一来源**：条目的 `tags` 既决定卡片左侧筛选条怎么分类它，也决定
 * 它进哪几颗任务型内置 skill 的索引。所以这四条闸门盯的不是"数据好看"，而是三种**静默失败**：
 *   ① 新标签没登记 —— 卡片露出英文原词（`capital-config.test.mjs` 也钉着），且它的条目永远不进任何索引；
 *   ② `serves` 拼错一个名字 —— 那颗条目"卡片能勾、会话目录里有、任务型 skill 的索引里永远没有"，零报错；
 *   ③ 一条都挂不上的条目 —— 只有兜底能救；兜底名单必须为空或逐条显式承认，不许悄悄多出来。
 */

const TASKS = SELECTED_SKILL_TASK_IDS

test('标签注册表：每个用到的标签都登记过，且中英两套显示名齐全', () => {
  const used = [...new Set(SELECTED_SKILL_CATALOG.flatMap((entry) => entry.tags))].sort()
  assert.ok(used.length >= 3, `catalog 只用到 ${used.length} 个标签，这条闸门多半被架空了`)
  const unregistered = used.filter((tag) => SELECTED_SKILL_TAGS[tag] === undefined)
  assert.deepEqual(unregistered, [], `这些标签没进 SELECTED_SKILL_TAGS：${unregistered.join(', ')}`)
  for (const tag of used) {
    const meta = SELECTED_SKILL_TAGS[tag]
    assert.equal(typeof meta.zh, 'string', `${tag} 缺中文显示名`)
    assert.ok(meta.zh.trim() !== '' && meta.en.trim() !== '', `${tag} 的显示名不许为空`)
  }
  // 词表由注册表现算：键集必须**逐字相等**（多一个 = 有人手抄了一份，少一个 = 派生被绕过）。
  assert.deepEqual(Object.keys(SELECTED_SKILL_TAG_LABELS.zh).sort(), ['all', ...Object.keys(SELECTED_SKILL_TAGS)].sort())
  assert.deepEqual(Object.keys(SELECTED_SKILL_TAG_LABELS.en).sort(), Object.keys(SELECTED_SKILL_TAG_LABELS.zh).sort())
  for (const [tag, meta] of Object.entries(SELECTED_SKILL_TAGS)) {
    assert.equal(SELECTED_SKILL_TAG_LABELS.zh[tag], meta.zh, `${tag} 的中文名必须来自注册表本身`)
    assert.equal(SELECTED_SKILL_TAG_LABELS.en[tag], meta.en, `${tag} 的英文名必须来自注册表本身`)
  }
})

test('标签注册表：serves 与 fallback 二选一，名字必须是本仓真实的任务型 skill', () => {
  for (const [tag, meta] of Object.entries(SELECTED_SKILL_TAGS)) {
    const axis = SELECTED_SKILL_TAG_AXES[meta.axis]
    assert.ok(axis, `标签 ${tag} 的 axis "${meta.axis}" 不在 SELECTED_SKILL_TAG_AXES 里`)
    const routes = axis.routes === true
    if (!routes) {
      // 不路由的轴（市场口径）只做标注：写 serves 等于把"是 A 股"当成"服务单股研究"，
      // 2026-10-13 实测过一次——那会让三颗任务型 skill 得到完全相同的清单，索引等于失效。
      assert.deepEqual(meta.serves, [], `${tag} 在不路由的轴上，不该写 serves`)
      assert.notEqual(meta.fallback, true, `${tag} 在不路由的轴上，不该写 fallback`)
      continue
    }
    const hasServes = meta.serves.length > 0
    assert.notEqual(hasServes && meta.fallback === true, true, `${tag} 同时给了 serves 与 fallback：只能二选一`)
    assert.ok(hasServes || meta.fallback === true, `标签 ${tag} 既没 serves 也没 fallback —— 它的条目会变成孤儿`)
    const bogus = meta.serves.filter((task) => !TASKS.includes(task))
    assert.deepEqual(bogus, [], `${tag} 的 serves 里这些名字不是本仓的任务型 skill：${bogus.join(', ')}`)
    assert.equal(new Set(meta.serves).size, meta.serves.length, `${tag} 的 serves 有重复项`)
  }
  assert.ok(TASKS.includes(SELECTED_SKILL_FALLBACK_TASK), '兜底目标必须是任务型 skill 之一')
})

test('反向可达：每颗任务型 skill 都收得到标签，每颗精选条目都至少进一颗的索引', () => {
  for (const task of TASKS) {
    assert.ok(taskSkillTags(task).length > 0, `${task} 一个标签都收不到：它的索引会恒为空，功能静默失效`)
  }
  // 三颗索引的并集必须覆盖全部条目：覆盖不到的条目 = 用户开了它、却没有任何任务框架会提到它。
  const allNames = new Set(SELECTED_SKILL_CATALOG.map((entry) => entry.name))
  const reached = new Set(TASKS.flatMap((task) => selectedSkillsForTask(task, allNames).map((entry) => entry.name)))
  const orphaned = [...allNames].filter((name) => !reached.has(name)).sort()
  assert.deepEqual(orphaned, [], `这些精选 skill 进不了任何任务型 skill 的索引：${orphaned.join(', ')}`)
  // 兜底名单当前必须为空：多出条目 = 有人加了标签却忘了挂，或者故意兜底却没写进这里。
  assert.deepEqual(fallbackOnlySkillNames(), [], '兜底名单变了：确认是无心漏挂还是有意兜底，再改这条断言')
})

test('路由语义：市场口径不路由，能力/主题标签决定进哪几颗', () => {
  const only = (...names) => new Set(names)
  const has = (task, name) => selectedSkillsForTask(task, only(name)).some((entry) => entry.name === name)

  // `us-stock` 只是标注：`tax-lens`（us-stock/tax/portfolio）不得因此进单股研究。
  assert.equal(has('capital-equity-research', 'tax-lens'), false, 'us-stock 不该把税务颗带进 equity')
  assert.equal(has('capital-portfolio-review', 'tax-lens'), true, 'tax/portfolio 服务组合复盘')
  assert.equal(has('capital-equity-research', '10k-digest'), true, 'filings 服务单股研究')
  assert.equal(has('capital-portfolio-review', '10k-digest'), false, '披露文件深读不该进组合复盘')
  assert.equal(has('capital-event-impact', '10k-digest'), true, 'filings 也服务事件影响')
  for (const task of TASKS) {
    assert.equal(has(task, 'risk-warning-catalysts'), true, 'risk 三颗都收')
  }
  // 未启用的一颗都不许漏进索引（§9.7：目录、索引、测试必须同一份"已启用集合"）：
  // 开着 `tax-lens` 时，equity 的索引里不许出现任何别家的名字。
  assert.deepEqual(selectedSkillsForTask('capital-equity-research', only()), [])
  assert.deepEqual(selectedSkillsForTask('capital-equity-research', only('tax-lens')).map((entry) => entry.name), [],
    '没启用的不许出现：tax-lens 不进 equity，别的更不许顺带进来')
})

test('上限不变量：编辑期封顶，运行期不截断（老配置照常全部生效）', () => {
  assert.ok(Number.isInteger(SELECTED_SKILLS_MAX_ENABLED) && SELECTED_SKILLS_MAX_ENABLED > 0,
    '上限必须是正整数')
  // 运行期**不按上限截断**：超过上限的已启用集合（老配置）照常全部进索引，否则就是
  // "卡片上开着 10 个、会话里只剩 6 个"的静默砍功能。卡片那一侧的封顶由
  // `capital-config.test.mjs` 钉住（禁用 + 提示），两处判据不同，不能互相顶替。
  const all = new Set(SELECTED_SKILL_CATALOG.map((entry) => entry.name))
  assert.ok(all.size > SELECTED_SKILLS_MAX_ENABLED * 2, '样本太小，这条断言量不出"没截断"')
  for (const task of TASKS) {
    const index = selectedSkillsForTask(task, all)
    assert.ok(index.length > SELECTED_SKILLS_MAX_ENABLED,
      `${task} 的索引被截到 ${index.length} 条：运行期不许按上限截断`)
    assert.equal(new Set(index.map((entry) => entry.name)).size, index.length, `${task} 的索引有重复条目`)
  }
})

test('注册表：market 轴标签只标注（当日 24 个标签的轴与归属逐条钉住）', () => {
  const market = Object.entries(SELECTED_SKILL_TAGS).filter(([, meta]) => meta.axis === 'market').map(([tag]) => tag)
  assert.deepEqual(market.sort(), ['a-share', 'us-stock'], '市场轴的标签集变了：确认新市场口径确实不路由')
  const routing = Object.keys(SELECTED_SKILL_TAGS).filter((tag) => taggedTaskSkills(tag).length > 0)
  assert.equal(routing.length, Object.keys(SELECTED_SKILL_TAGS).length - market.length,
    '除市场轴外，每个标签都该路由到至少一颗任务型 skill')
})
