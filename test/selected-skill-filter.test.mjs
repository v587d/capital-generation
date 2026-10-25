import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SELECTED_SKILL_CATALOG } from '../selected-skills/catalog.js'
import {
  SELECTED_SKILL_FILTER_ALL,
  filterSelectedSkills,
  selectedSkillFacetCounts,
  selectedSkillPresetTotals,
  selectedSkillRoles,
  selectedSkillTraitOrder,
} from '../selected-skills/filter.js'
import {
  SELECTED_SKILL_PRESETS,
  SELECTED_SKILL_PRESET_ORDER,
  SELECTED_SKILL_ROLES,
} from '../selected-skills/routing.js'
import { allPresets } from './preset-rows.mjs'

const PRESET_IDS = {
  main: 'capital-generation',
  data_collector: 'capital-data-collector',
  web_retriever: 'capital-web-retriever',
  data_junior: 'capital-data-junior',
  visualization_specialist: 'capital-visualization-specialist',
}

test('预设筛选沿用选择器里的五个名字，两个不加载方法的预设计数为 0', () => {
  assert.deepEqual(Object.keys(SELECTED_SKILL_PRESETS), [...SELECTED_SKILL_PRESET_ORDER],
    '预设表的键就是筛选顺序')
  assert.deepEqual(SELECTED_SKILL_PRESET_ORDER.map((preset) => SELECTED_SKILL_PRESETS[preset].zh),
    ['自动模式', '行情专家', '资讯专员', '分析师', '绘图专员'])
  for (const role of Object.keys(SELECTED_SKILL_ROLES)) {
    assert.ok(SELECTED_SKILL_PRESETS[role], `执行角色 ${role} 没有对应的预设显示名`)
  }
  const totals = selectedSkillPresetTotals()
  assert.equal(totals.get('data_collector'), 0, '行情专家只取数，不加载精选 Skills')
  assert.equal(totals.get('visualization_specialist'), 0, '绘图专员只出图，不加载精选 Skills')
  for (const preset of ['main', 'web_retriever', 'data_junior']) {
    assert.ok(totals.get(preset) > 0, `${preset} 一颗方法都没有`)
  }
})

test('筛选里的预设名逐字跟着选择器卡片，改名时两处一起动', () => {
  const names = Object.fromEntries(allPresets().map((preset) => [preset.config.id, preset.config.name]))
  for (const [preset, presetId] of Object.entries(PRESET_IDS)) {
    assert.equal(SELECTED_SKILL_PRESETS[preset].zh, names[presetId],
      `${preset} 的筛选名与 ${presetId} 卡片名不一致：用户在筛选条和选择器里会看到两个名字`)
  }
})

test('两个维度同时选择时取交集，任一维度为全部就只剩另一个约束', () => {
  assert.deepEqual(filterSelectedSkills(), SELECTED_SKILL_CATALOG,
    '默认两个维度都是全部')
  const byTrait = SELECTED_SKILL_CATALOG.filter((entry) => entry.tags.includes('risk'))
  const byPreset = SELECTED_SKILL_CATALOG.filter((entry) => selectedSkillRoles(entry).includes('data_junior'))
  const both = filterSelectedSkills({ trait: 'risk', preset: 'data_junior' })
  assert.deepEqual(both, byTrait.filter((entry) => byPreset.includes(entry)),
    '特点与预设同时选中时，清单是两份集合的交集')
  assert.ok(both.length > 0 && both.length < byTrait.length, '测试选的这颗特点必须真被预设收窄，否则交集断言是空的')
  assert.deepEqual(filterSelectedSkills({ trait: 'risk' }), byTrait)
  assert.deepEqual(filterSelectedSkills({ preset: 'data_junior' }), byPreset)
  assert.deepEqual(filterSelectedSkills({ trait: SELECTED_SKILL_FILTER_ALL, preset: SELECTED_SKILL_FILTER_ALL }),
    SELECTED_SKILL_CATALOG)
})

test('筛选条计数回答"再点这一格会显示几行"，因此按另一维度的当前选择计算', () => {
  const trait = 'risk'
  const preset = 'data_junior'
  const facets = selectedSkillFacetCounts({ trait, preset })
  assert.equal(facets.traits.get(SELECTED_SKILL_FILTER_ALL), filterSelectedSkills({ preset }).length,
    '特点维度的「全部」= 当前预设下的全部')
  assert.equal(facets.presets.get(SELECTED_SKILL_FILTER_ALL), filterSelectedSkills({ trait }).length,
    '预设维度的「全部」= 当前特点下的全部')

  const traitOrder = selectedSkillTraitOrder()
  for (const tag of traitOrder) {
    const expected = tag === SELECTED_SKILL_FILTER_ALL
      ? filterSelectedSkills({ preset }).length
      : filterSelectedSkills({ trait: tag, preset }).length
    assert.equal(facets.traits.get(tag) ?? 0, expected, `${tag} 的计数与点下去会显示的行数不一致`)
  }
  for (const key of SELECTED_SKILL_PRESET_ORDER) {
    const expected = filterSelectedSkills({ trait, preset: key }).length
    assert.equal(facets.presets.get(key) ?? 0, expected, `${key} 的计数与点下去会显示的行数不一致`)
  }
})

test('特点顺序按全量条数排，不随另一维度的选择跳位', () => {
  const order = selectedSkillTraitOrder()
  assert.equal(order[0], SELECTED_SKILL_FILTER_ALL, '「全部」恒在第一格')
  const counts = new Map()
  for (const entry of SELECTED_SKILL_CATALOG) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const expected = [...counts.keys()].sort((left, right) => counts.get(right) - counts.get(left))
  assert.deepEqual(order.slice(1), expected, '同一份计数只决定初始顺序，筛选时不变')
})
