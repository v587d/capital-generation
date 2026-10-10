/**
 * `/capital-skills/<skill 名>.md` 闸门：设置卡片「详情」那一份 `SKILL.md` 原文的来路。
 *
 * 三条纪律各对应一类事故，都不是猜测：
 *  - ⛔ **认证围栏**：`webServer.register({kind:'prefix'})` 本身不做任何认证，不接
 *    `connection.requestRejection` 就等于"任何本机进程凭路径即可读插件目录里的文件"
 *    （docs/dev/chart-presentation.md §6.1，与 `/capital-charts`、`/capital-watchlist` 同一条）。
 *    所以第一条用例断言的是**被拒时连一次读盘都没有**。
 *  - **闭集**：请求里的名字只当 `SKILL_DOCS` 这张表的键用，不参与任何路径拼接。
 *  - **宁缺毋滥**：超限整份拒绝而不是切一半——"原文"被截掉一段，比明确说读不到更误导人
 *    （官方 `workspaceFiles` 的 `maxFileBytes` 也是"refused, never truncated"同一条口径）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apply as hostApply,
  createSkillDocHandler,
  MAX_SKILL_DOC_BYTES,
  SKILL_DOCS,
  SKILL_DOC_ROUTE,
  skillDocUrl,
} from '../capital-config/index.js'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'
import { fakeCtx } from './cordis-fake.mjs'
import { httpFixture } from './watchlist-harness.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

async function call(handler, input) {
  const { req, res } = httpFixture(input)
  await handler(req, res)
  return res
}

/** 假读盘：记下被读的是哪一颗，好断言"被拒的请求一次都没碰到文件系统"。 */
function fakeFs({ contents = new Map(), sizes = new Map() } = {}) {
  const statCalls = []
  const readCalls = []
  return {
    statCalls,
    readCalls,
    statSize: (target) => {
      statCalls.push(String(target))
      return sizes.get(String(target)) ?? 128
    },
    readFile: (target) => {
      readCalls.push(String(target))
      return contents.get(String(target)) ?? '# 原文\n'
    },
  }
}

test('闭集：catalog 每一条都排得出自己的快照，且排出来的就是那份文件', () => {
  assert.equal(SKILL_DOCS.size, SELECTED_SKILL_CATALOG.length, '原文索引与 catalog 同条数')
  for (const entry of SELECTED_SKILL_CATALOG) {
    const target = SKILL_DOCS.get(entry.name)
    assert.ok(target, `${entry.name} 没有排进原文索引（卡片上那一行的「详情」会是空的）`)
    const path = decodeURIComponent(target.pathname)
    assert.ok(path.endsWith(`/${entry.repository}/${SELECTED_SKILL_SKILL_DIRS[entry.repository]}/${entry.name}/SKILL.md`),
      `${entry.name} 的落点不对：${path}`)
    assert.ok(existsSync(target), `${entry.name} 的快照文件不在包里：${path}（files 清单漏了还是目录换了）`)
  }
  // 表里没有的键，无论怎么写都拼不出路径：这条是"闭集"与"路径拼接"的分水岭。
  assert.equal(SKILL_DOCS.get('../../etc/passwd'), undefined)
})

test('⛔ 缺 cookie（401）/ 非受信 Origin（403）时一次盘都不读；围栏自己抛错按 401 收口', async () => {
  for (const [name, authorize, expected] of [
    ['缺 cookie', () => 401, 401],
    ['非受信 Host', () => 403, 403],
    ['围栏抛错', () => { throw new Error('context destroyed') }, 401],
  ]) {
    const fs = fakeFs()
    const handler = createSkillDocHandler({ ...fs, authorize })
    const res = await call(handler, { method: 'GET', url: `${SKILL_DOC_ROUTE}/buffett-investment-framework.md` })
    assert.equal(res.statusCode, expected, `${name} 必须拒掉`)
    assert.deepEqual(fs.readCalls, [], `${name} 的请求不许落到文件系统`)
    assert.deepEqual(fs.statCalls, [], `${name} 的请求连存在性都不试探`)
  }
})

test('没有认证面的载体（Electron / file://）不加围栏也不假装存在', async () => {
  const fs = fakeFs()
  const res = await call(createSkillDocHandler(fs), { method: 'GET', url: `${SKILL_DOC_ROUTE}/bear-case.md` })
  assert.equal(res.statusCode, 200, 'connection 缺席时按本地载体的旧行为放行')
})

test('只放行 GET；其余 405', async () => {
  const fs = fakeFs()
  const handler = createSkillDocHandler(fs)
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await call(handler, { method, url: `${SKILL_DOC_ROUTE}/bear-case.md` })
    assert.equal(res.statusCode, 405)
    assert.equal(res.json().error, 'method_not_allowed')
  }
  assert.deepEqual(fs.readCalls, [], '405 也是没读盘的')
})

test('路径一律按表查：不在 catalog 里的名字、越界写法、缺后缀都只得到 404', async () => {
  for (const url of [
    `${SKILL_DOC_ROUTE}/../capital-config/index.js`,
    `${SKILL_DOC_ROUTE}/..%2F..%2Fetc%2Fpasswd.md`,
    `${SKILL_DOC_ROUTE}/%2e%2e.md`,
    `${SKILL_DOC_ROUTE}/no-such-skill.md`,
    `${SKILL_DOC_ROUTE}/bear-case`,
    `${SKILL_DOC_ROUTE}/bear-case.txt`,
    '/other-prefix/bear-case.md',
  ]) {
    const fs = fakeFs()
    const res = await call(createSkillDocHandler(fs), { method: 'GET', url })
    assert.ok(res.statusCode === 404 || res.statusCode === 400, `${url} 应当被拒：拿到 ${res.statusCode}`)
    assert.deepEqual(fs.readCalls, [], `${url} 不许落到文件系统`)
  }
})

test('读得到的那份原文：200、纯文本、no-store、nosniff', async () => {
  const name = SELECTED_SKILL_CATALOG[0].name
  const target = SKILL_DOCS.get(name)
  const fs = fakeFs({ contents: new Map([[String(target), '# 标题\n正文']]), sizes: new Map([[String(target), 12]]) })
  const res = await call(createSkillDocHandler(fs), { method: 'GET', url: skillDocUrl(name) })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, '# 标题\n正文')
  assert.equal(res.headers['cache-control'], 'no-store', '快照会被上游更新，缓存住就是拿旧原文说"这是原文"')
  assert.match(String(res.headers['content-type']), /text\/plain/)
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
})

test('默认读盘走的是包内那一份快照（不是构建期抄的副本）', async () => {
  const name = SELECTED_SKILL_CATALOG[0].name
  const res = await call(createSkillDocHandler(), { method: 'GET', url: skillDocUrl(name) })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, new RegExp(`^---[\\s\\S]*name: ${name}`), 'frontmatter 里的 name 就是这一条 skill')
  assert.equal(res.body, readFileSync(SKILL_DOCS.get(name), 'utf8'), '响应逐字等于磁盘上那份文件')
})

test('快照缺席 → 404 说清楚；超限 → 413 整份拒绝，绝不回半份"原文"', async () => {
  const name = 'bear-case'
  const target = SKILL_DOCS.get(name)
  const missing = await call(
    createSkillDocHandler({ readFile: () => '', statSize: () => { throw new Error('enoent') } }),
    { method: 'GET', url: skillDocUrl(name) },
  )
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error, 'skill_doc_unreadable')

  const readFailed = await call(
    createSkillDocHandler({ statSize: () => 10, readFile: () => { throw new Error('enoent') } }),
    { method: 'GET', url: skillDocUrl(name) },
  )
  assert.equal(readFailed.statusCode, 404, 'stat 通过、读的时候才失败（快照刚被换掉）也是同一句')

  const huge = await call(
    createSkillDocHandler({ ...fakeFs({ sizes: new Map([[String(target), MAX_SKILL_DOC_BYTES + 1]]) }) }),
    { method: 'GET', url: skillDocUrl(name) },
  )
  assert.equal(huge.statusCode, 413)
  assert.equal(huge.json().limit, MAX_SKILL_DOC_BYTES)
  assert.equal(huge.body.includes('原文'), false, '超限时一个字的正文都不许出去')
})

test('apply：原文旁路只经 inject 挂到 webServer 上（探测式写法会炸真机）', () => {
  const registered = []
  const { ctx, injected } = fakeCtx({
    webServer: { register: (route) => { registered.push(route); return () => {} } },
    connection: { requestRejection: () => undefined },
  })
  hostApply(ctx)
  assert.deepEqual(injected.map((item) => item.deps), [['webServer']])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, SKILL_DOC_ROUTE)
  assert.equal(typeof registered[0].handler, 'function')

  // 路由字符串是同字链的两端：客户端 bundle 里那份必须逐字等于这一份。
  const clientSource = readFileSync(join(ROOT, 'capital-config', 'client.src.cjs'), 'utf8')
  const clientRoute = /^const SKILL_DOC_ROUTE = '([^']+)'/m.exec(clientSource)?.[1]
  assert.equal(clientRoute, SKILL_DOC_ROUTE, '客户端拼的地址与 host 注册的前缀漂移 = 「详情」永远读不到，且零报错')
  assert.match(clientSource, /fetch\(skillDocUrl\(name\)/, '客户端只经这一处出口取原文')
  assert.match(clientSource, /`\$\{SKILL_DOC_ROUTE\}\/\$\{encodeURIComponent\(name\)\}\.md`/,
    '地址模板也要同字：slug 里有以 . 结尾的名字（10k-digest 这类），少 encode 就 404')
  assert.equal(skillDocUrl('10k-digest'), '/capital-skills/10k-digest.md')
})

test('没有 webServer 的载体：本行仍激活，只是不挂路由', () => {
  const registered = []
  const { ctx, injected } = fakeCtx({ webServer: undefined })
  hostApply(ctx)
  assert.equal(injected.length, 1, 'inject 挂着等（本行仍算激活），不是"没探到就跳过"')
  assert.deepEqual(registered, [])
})
