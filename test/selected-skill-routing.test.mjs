import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  SELECTED_SKILL_CATALOG,
  SELECTED_SKILL_TAGS,
  SELECTED_SKILL_TAG_AXES,
  SELECTED_SKILL_TAG_LABELS,
} from '../selected-skills/catalog.js'
import {
  SELECTED_SKILL_METHODS,
  SELECTED_SKILL_REQUIREMENTS,
  SELECTED_SKILL_ROLES,
  SELECTED_SKILL_ROUTING,
  SELECTED_SKILL_STAGES,
} from '../selected-skills/routing.js'

const NAMES = SELECTED_SKILL_CATALOG.map(({ name }) => name)
const ROUTED = Object.keys(SELECTED_SKILL_ROUTING)
const ROLE_KEYS = Object.keys(SELECTED_SKILL_ROLES)
const REVIEW_TABLE = readFileSync(new URL('../selected-skills/ROUTING.md', import.meta.url), 'utf8')
const MARKET_KEYS = ['a-share', 'us-stock', 'global']

test('routing 与 catalog 一一对应：没有孤儿，也没有指向空气的元数据', () => {
  assert.deepEqual([...ROUTED].sort(), [...NAMES].sort(), 'catalog 与 routing 的键集必须完全相同')
  for (const name of NAMES) {
    const routing = SELECTED_SKILL_ROUTING[name]
    assert.ok(routing, `${name} 没有 routing 元数据：provider 会静默把它从所有角色目录里漏掉`)
    assert.ok(routing.roles.length > 0, `${name} 一个角色都没有`)
    assert.ok(routing.roles.includes(routing.primaryRole), `${name} 的 primaryRole 不在 roles 里`)
    for (const role of routing.roles) assert.ok(ROLE_KEYS.includes(role), `${name} 的角色 ${role} 未登记`)
    assert.ok(MARKET_KEYS.includes(routing.market[0]), `${name} 的市场口径未登记：${routing.market.join(',')}`)
    for (const market of routing.market) assert.ok(MARKET_KEYS.includes(market), `${name} 的市场口径 ${market} 未登记`)
    assert.ok(SELECTED_SKILL_STAGES[routing.stage], `${name} 的 stage ${routing.stage} 未登记`)
    assert.ok(routing.methods.length > 0, `${name} 没有任何方法标签`)
    for (const method of routing.methods) assert.ok(SELECTED_SKILL_METHODS[method], `${name} 的方法 ${method} 未登记`)
    assert.ok(routing.requires.length > 0, `${name} 没有声明数据/输入依赖`)
    for (const requirement of routing.requires) assert.ok(SELECTED_SKILL_REQUIREMENTS[requirement], `${name} 的依赖 ${requirement} 未登记`)
  }
})

test('每颗都有明确的触发条件：中文“当…时使用” + 英文 Use when / Triggers on', () => {
  for (const name of NAMES) {
    const when = SELECTED_SKILL_ROUTING[name].useWhen
    assert.ok(when.zh.includes('当') && when.zh.includes('时使用'), `${name} 的中文触发条件缺“当…时使用”：${when.zh}`)
    assert.ok(when.zh.length <= 500, `${name} 的中文触发条件 ${when.zh.length} 字符，超过宿主目录上限`)
    assert.ok(when.en.startsWith('Use when '), `${name} 的英文触发条件必须以 Use when 开头`)
    assert.ok(when.en.includes('Triggers on'), `${name} 的英文触发条件缺 Triggers on`)
    assert.ok(when.en.length <= 500, `${name} 的英文触发条件 ${when.en.length} 字符，超过宿主目录上限`)
  }
})

test('重叠族双向可达，canonicalFor 每个槽位只有一个默认项', () => {
  for (const name of NAMES) {
    for (const other of SELECTED_SKILL_ROUTING[name].overlaps) {
      assert.ok(NAMES.includes(other), `${name} 的 overlaps 指向不存在的 ${other}`)
      assert.notEqual(other, name, `${name} 把自己列为 overlap`)
      assert.ok(SELECTED_SKILL_ROUTING[other].overlaps.includes(name), `${name} → ${other} 的重叠不是双向的`)
    }
  }
  const owners = new Map()
  for (const name of NAMES) {
    for (const slot of SELECTED_SKILL_ROUTING[name].canonicalFor) {
      assert.ok(!owners.has(slot) || owners.get(slot) === name,
        `canonicalFor ${slot} 同时指向 ${owners.get(slot)} 与 ${name}`)
      owners.set(slot, name)
    }
  }
  assert.ok(owners.size > 0, 'canonicalFor 一个都没登记：自动模式在同族里没有默认项')
})

test('角色分工有下限：每个角色至少能拿到一颗方法，且主/分析/检索都不是空壳', () => {
  for (const role of ROLE_KEYS) {
    const members = NAMES.filter((name) => SELECTED_SKILL_ROUTING[name].roles.includes(role))
    assert.ok(members.length > 0, `${role} 一颗方法都没有`)
  }
  const primary = Object.fromEntries(ROLE_KEYS.map((role) => [role, NAMES.filter((name) => SELECTED_SKILL_ROUTING[name].primaryRole === role).length]))
  assert.deepEqual(primary, { main: 31, data_junior: 36, web_retriever: 3 },
    `主/分析/检索的 primaryRole 分工变了：${JSON.stringify(primary)}。这是一次产品决策，先改文档与评审再改这条断言`)
  const memberships = Object.fromEntries(ROLE_KEYS.map((role) => [role, NAMES.filter((name) => SELECTED_SKILL_ROUTING[name].roles.includes(role)).length]))
  assert.deepEqual(memberships, { main: 39, data_junior: 40, web_retriever: 8 },
    `角色成员数变了：${JSON.stringify(memberships)}。多角色是“同一方法真的由两边执行”，不是“谁可能感兴趣”`)
})

test('70 行 review 表与 routing 同步：名字与中文触发条件逐条出现', () => {
  assert.equal((REVIEW_TABLE.match(/^\| \d+ \|/gm) ?? []).length, NAMES.length, 'ROUTING.md 的行数与 catalog 不一致')
  for (const name of NAMES) {
    assert.ok(REVIEW_TABLE.includes(`\`${name}\``), `ROUTING.md 缺 ${name}`)
    assert.ok(REVIEW_TABLE.includes(SELECTED_SKILL_ROUTING[name].useWhen.zh), `ROUTING.md 的触发条件与 routing.js 不一致：${name}`)
  }
})

test('展示标签仍是完整词表，且只做筛选不再承担路由', () => {
  for (const entry of SELECTED_SKILL_CATALOG) {
    for (const tag of entry.tags) {
      assert.ok(SELECTED_SKILL_TAGS[tag], `${entry.name} 用了未登记的标签 ${tag}`)
    }
  }
  for (const [tag, meta] of Object.entries(SELECTED_SKILL_TAGS)) {
    assert.ok(meta.zh && meta.en, `标签 ${tag} 缺中文或英文显示名`)
    assert.ok(SELECTED_SKILL_TAG_AXES[meta.axis], `标签 ${tag} 的 axis ${meta.axis} 未登记`)
    assert.equal(meta.serves, undefined, `标签 ${tag} 还带着已废弃的 serves 路由字段`)
  }
  for (const locale of ['zh', 'en']) {
    assert.deepEqual(Object.keys(SELECTED_SKILL_TAG_LABELS[locale]).sort(), ['all', ...Object.keys(SELECTED_SKILL_TAGS)].sort(),
      `${locale} 的标签词表与注册表不一致`)
  }
})
