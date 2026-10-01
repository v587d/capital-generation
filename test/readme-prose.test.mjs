import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * README 的受众闸门：首页是**写给读者看的**，不是写给仓库自己看的。
 *
 * 研发黑话（§编号、`docs/dev/`、`ctx.*`、`*_ref`、`persona` / `toolFilter` 这类实现层标识）在
 * `AGENTS.md` 与 `docs/dev/` 里是必需的精确指针，搬进 README 就只剩成本：读者查不到那个名字，
 * 也无处下单——他能做的只有照抄一句看不懂的话去问 Agent。所以这里不看措辞（措辞断言必然被人为
 * 变绿而放宽），只钉**形状**：黑话都有可识别的形状，且这些形状在本仓只有研发文档这一个来源。
 *
 * 只看散文：围栏代码块整段跳过。`npm run build`、`dsh plugin … add` 里的路径与命令是用户要照着
 * 敲的，属于"给人看的字"，不是黑话。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(`${ROOT}README.md`, 'utf8')
const prose = readme.replace(/^```[\s\S]*?^```[ \t]*$/gm, '')

/** [形状, 为什么它是黑话]。命中即失败，并说明该词住在哪。 */
const JARGON = [
  [/§\d/g, '§编号是 AGENTS.md 与 docs/dev/ 的指针命名空间，读者那边没有这份文档'],
  [/docs\/dev\/\S*/g, 'docs/dev/ 是研发详情层，不该出现在首页链接里'],
  [/\bctx\.\w/g, '`ctx.*` 是插件内部 API'],
  [/\b\w+_(?:ref|id)\b/g, '`*_ref` / `*_id` 是工具之间的内部引用名'],
  [/\b(?:src|preset|scripts)\/[\w./-]+/g, '仓内源码路径是实现细节，读者改不到'],
  [/\b(?:toolFilter|isConcurrencySafe|SAFE_RESULT_CHARS|FiberState|DatasetRef|persona|one-shot|continuable|volatile|boot graph|host 平面|agent-instructions|maxBytes)\b/g, '实现层标识'],
]

for (const [pattern, reason] of JARGON) {
  test(`README 不写研发黑话：${reason}`, () => {
    const hits = [...prose.matchAll(pattern)].map((match) => match[0])
    assert.deepEqual(hits, [], `README 里出现了「${hits.join('、')}」——${reason}。要留给读者的写法：说这件事的**结果**（用户会看到什么、要做什么），需要细节就链接 docs 里那几份能力表。`)
  })
}

test('README 的黑话闸门不许被整体注释掉', () => {
  // 这条防的是最省事的绕过方式：把 JARGON 清空或整段注掉，上面那些用例就全绿了。
  assert.ok(JARGON.length >= 5, `黑话形状清单只剩 ${JARGON.length} 条，低于 5 条即视为被削减`)
  assert.ok(prose.includes('# Capital Generation'), 'README 正文本身应可读（标题行缺失多半是文件被截断）')
})
