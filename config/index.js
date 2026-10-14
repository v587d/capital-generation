import z from '@deepseek-ai/schemastery'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

export const name = 'capital-config'

/**
 * 本包在 profile 里的**条目 id**。0.1.7 起它就是 settings 命名空间本身：
 * `dsh-settings` 不再接受 `settings.register()`，而是把**活动 profile 条目**的 Config schema 里
 * 声明为 `.volatile()` 的字段投影成表单，`ns` 恒等于 `entry.options.id`。两个事实因此承重：
 *
 *  1. **它是卡片的取数通道**：浏览器半边 `ctx.configForms.get(条目 id)` 与
 *     `whileServed([条目 id])` 都按它寻址；卡片本身注册进 `plugins.bundle.config`，
 *     key 是**组合包的包名**（`@v587d/capital-generation`），不是 `<包名>#<行 id>`。
 *     条目 id 或包名任一处漂移，表现都是**卡片静默消失**（零报错）。
 *  2. **它是取数配置的来源**：主插件 `@v587d/capital-generation` 经
 *     `settings.describe()` 读同一条目的解析值，拿 `fuyaoCredentialRef` /
 *     `retriever.credentialRef` / `retriever.windDocs.credentialRef` /
 *     `retriever.paddleOcr.credentialRef` 这些**引用名**去寻密钥。
 *
 * 密钥本身恒不进本条目：API Key 写在 credentials 域（`remote.credentials.set`），
 * 这里只存引用名。唯一写进配置的偏好是回退开关 `retriever.localFetch.enabled`。
 *
 * ⛔ 字段必须 `.volatile()`：`volatileForm(schema)` 在没有任何 volatile 字段时返回
 * `undefined`，该条目就**不进** describe 镜像——卡片读不到命名空间，写入也会被
 * `Config field "…" is not volatile` 拒绝。非 volatile 字段仍是普通配置，只能改 profile 文件。
 *
 * 浏览器半边镜像了这个 id（`client.src.cjs` 的 `ENTRY_ID`），两处同改由
 * `test/capital-config.test.mjs` 钉住。
 */
export const SETTINGS_ENTRY_ID = 'capital-config'

const WindDocsSchema = z.object({
  endpoint: z.string().default('').volatile().description('可选：覆盖 Wind 文档检索端点'),
  credentialRef: z.string().default('WIND_API_KEY').volatile().description('Wind credentials 引用名'),
  timeoutMs: z.number().default(60000).volatile().description('Wind 请求超时毫秒'),
})

/**
 * 本地直连回退默认值。必须与主插件 `src/index.ts` 的 `LOCAL_FETCH_DEFAULTS` 逐字一致
 * （两处 schema 漂移会被 `test/capital-config.test.mjs` 的 deepEqual 用例抓住）。
 * 数值口径对齐官方 `dsh-web-fetch-http`（timeoutMs=30000 / maxBodyChars=100000）；
 * `maxContentChars` 切在转换前的原始 HTML 上，所以按 HTML 体积给足。
 * `userAgent` 默认是产品标识；显式配成空串时消费点回落到插件版本号。
 */
export const LOCAL_FETCH_DEFAULTS = {
  enabled: true,
  timeoutMs: 30000,
  maxBytes: 524288,
  maxContentChars: 100000,
  maxRedirects: 5,
  userAgent: '@v587d/capital-generation',
}

const LocalFetchSchema = z.object({
  enabled: z.boolean().default(LOCAL_FETCH_DEFAULTS.enabled).volatile().description('是否允许本机直连出网：AnySearch 失败后的回退抓取 + 具名来源工具的执行（默认开启；关闭时来源工具调用响亮失败）'),
  timeoutMs: z.number().default(LOCAL_FETCH_DEFAULTS.timeoutMs).volatile().description('本机直连单次请求超时毫秒'),
  maxBytes: z.number().default(LOCAL_FETCH_DEFAULTS.maxBytes).volatile().description('本机直连响应体字节上限'),
  maxContentChars: z.number().default(LOCAL_FETCH_DEFAULTS.maxContentChars).volatile().description('本机直连正文码点上限（切在转换前的原始 HTML 上，不是 markdown 输出）'),
  maxRedirects: z.number().default(LOCAL_FETCH_DEFAULTS.maxRedirects).volatile().description('本机直连最大重定向跳数'),
  userAgent: z.string().default(LOCAL_FETCH_DEFAULTS.userAgent).volatile().description('本机直连 User-Agent；空 = 回落到插件版本号'),
})

/**
 * PaddleOCR 文档解析（`ocr` 工具）默认值。必须与主插件 `src/index.ts` 的
 * `PADDLE_OCR_DEFAULTS` 逐字一致（漂移被 `test/capital-config.test.mjs` 的 deepEqual 抓住）。
 *
 * `endpoint` / `model` 留空是把真值让给 `src/ocr/client.ts`；`pollBudgetMs: 0` = 客户端默认的
 * 200000 毫秒自有等待预算，必须小于 `ocr` 工具声明的 240000 超时，否则框架先超时、
 * 回执里没有 `doc_id` 可续查。
 */
export const PADDLE_OCR_DEFAULTS = {
  endpoint: '',
  credentialRef: 'PADDLE_OCR_TOKEN',
  model: '',
  pollBudgetMs: 0,
}

const PaddleOcrSchema = z.object({
  endpoint: z.string().default(PADDLE_OCR_DEFAULTS.endpoint).volatile().description('PaddleOCR 作业端点；空 = 官方端点'),
  credentialRef: z.string().default(PADDLE_OCR_DEFAULTS.credentialRef).volatile().description('PaddleOCR Token 的 credentials 引用名'),
  model: z.string().default(PADDLE_OCR_DEFAULTS.model).volatile().description('解析模型名；空 = PaddleOCR-VL-1.6'),
  pollBudgetMs: z.number().default(PADDLE_OCR_DEFAULTS.pollBudgetMs).volatile().description('ocr 内部等作业的预算毫秒，0 = 默认 200000'),
})

const SelectedSkillsShape = Object.fromEntries(SELECTED_SKILL_CATALOG.map((entry) => [
  entry.key,
  z.boolean().default(false).volatile().description(`Enable ${entry.name} for the Capital root Agent (experimental; default off)`),
]))
const SelectedSkillsSchema = z.object(SelectedSkillsShape)

const SELECTED_SKILL_DEFAULTS = Object.fromEntries(SELECTED_SKILL_CATALOG.map((entry) => [entry.key, false]))

export const Config = z.object({
  customPersona: z.string().default('').volatile().description('Capital 模式附加人设文本'),
  selectedSkills: SelectedSkillsSchema.default(SELECTED_SKILL_DEFAULTS).description('Explicitly selected community experiments; default off and visible only to the Capital root Agent'),
  fuyaoCredentialRef: z.string().default('FUYAO_API_KEY').volatile().description('Fuyao credentials 引用名'),
  retriever: z.object({
    baseURL: z.string().default('').volatile().description('AnySearch API 地址'),
    credentialRef: z.string().default('ANYSEARCH_API_KEY').volatile().description('AnySearch credentials 引用名'),
    windDocs: WindDocsSchema.default({
      endpoint: '',
      credentialRef: 'WIND_API_KEY',
      timeoutMs: 60000,
    }),
    localFetch: LocalFetchSchema.default({ ...LOCAL_FETCH_DEFAULTS }),
    paddleOcr: PaddleOcrSchema.default({ ...PADDLE_OCR_DEFAULTS }),
  }).default({
    baseURL: '',
    credentialRef: 'ANYSEARCH_API_KEY',
    windDocs: { endpoint: '', credentialRef: 'WIND_API_KEY', timeoutMs: 60000 },
    localFetch: { ...LOCAL_FETCH_DEFAULTS },
    paddleOcr: { ...PADDLE_OCR_DEFAULTS },
  }),
})

/**
 * 「精选 Skills」那一格的**原文旁路**：卡片上的「详情」悬浮要显示 `SKILL.md` 原文，
 * 而原文是随包携带的快照文件（35 份共 ~750 KB）。
 *
 * 为什么走一条本机路由，而不是把原文打进客户端 bundle：客户端 bundle 在页面加载那一刻
 * 整体送达浏览器（`window.__ModuleLoader__.load` 是单文件 IIFE，没有按需分片），750 KB 会
 * 让每一次打开插件页都付一遍——包括从不点「详情」的那次。旁路只在悬停时取一份，且取的是
 * **磁盘上当前那份**，不是构建期抄的副本：抄来的原文会随快照更新而变旧，而这块 UI 说的
 * 是"这就是原文"（控件对自己的状态说谎 = 事故）。
 *
 * 闭集：路径按 `SELECTED_SKILL_CATALOG` × `SELECTED_SKILL_SKILL_DIRS` 在模块加载时现算成
 * `Map<skill 名, file: URL>`，请求里的名字**只做这张表的键**，不参与任何路径拼接——
 * `%2F..%2F` 之类一律落在"表里没有这个名字"那一侧（404）。路径用 `URL` 表示：`fs` 直接收
 * `file:` URL，省掉一次 `fileURLToPath`（也就省掉在 import 期依赖 node 内置模块）。
 *
 * ⛔ 认证围栏与 `/capital-charts`、`/capital-watchlist` 同一写法（`connection.requestRejection`，
 * docs/dev/chart-presentation.md §6.1）：`webServer.register({ kind: 'prefix' })` 本身不做任何认证。
 */
export const SKILL_DOC_ROUTE = '/capital-skills'
/** 单份原文的字节上限：超限**整份拒绝、绝不截断**（"原文"被切一半比没有原文更误导人）。 */
export const MAX_SKILL_DOC_BYTES = 128 * 1024

const SKILL_DOC_SUFFIX = 'SKILL.md'

/** catalog 里的顺序 = 卡片上的顺序，所以这里只多算一份"名字 → 快照文件"的索引。 */
export const SKILL_DOCS = new Map(SELECTED_SKILL_CATALOG.map((entry) => [
  entry.name,
  new URL(`../selected-skills/${entry.repository}/${SELECTED_SKILL_SKILL_DIRS[entry.repository]}/${entry.name}/${SKILL_DOC_SUFFIX}`, import.meta.url),
]))

function fsModule() {
  const processLike = globalThis.process
  const fs = processLike?.getBuiltinModule?.('node:fs')
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('capital-config: Node fs is unavailable')
  return fs
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(payload))
}

/**
 * @param options.readFile - `(url) => string | Buffer`，用例注入假读盘。
 * @param options.authorize - `(req) => 401 | 403 | undefined`；非空即拒，**且一次都不碰文件系统**。
 */
export function createSkillDocHandler(options = {}) {
  const readFile = options.readFile ?? ((target) => fsModule().readFileSync(target, 'utf8'))
  const statSize = options.statSize ?? ((target) => fsModule().statSync(target).size)
  const authorize = options.authorize
  return async function handler(req, res) {
    if (typeof authorize === 'function') {
      let rejection
      try {
        rejection = authorize(req)
      } catch {
        // 围栏自己答不上来时必须 fail closed：放行就等于"认证失败 = 不认证"。
        rejection = 401
      }
      if (rejection !== undefined && rejection !== null) {
        res.statusCode = rejection
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
    }
    if (req?.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      sendJson(res, 400, { error: 'bad_request' })
      return
    }
    if (!pathname.startsWith(`${SKILL_DOC_ROUTE}/`)) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    const match = /^([^/]+)\.md$/.exec(pathname.slice(`${SKILL_DOC_ROUTE}/`.length))
    if (!match) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    let name
    try {
      name = decodeURIComponent(match[1])
    } catch {
      sendJson(res, 400, { error: 'bad_request' })
      return
    }
    const target = SKILL_DOCS.get(name)
    if (target === undefined) {
      sendJson(res, 404, { error: 'skill_not_catalogued', name })
      return
    }
    let bytes
    try {
      bytes = statSize(target)
    } catch {
      // 快照没随包落地（装到一半 / files 清单漏了）：说清楚"读不到"，别回一份空原文当好结果。
      sendJson(res, 404, { error: 'skill_doc_unreadable', name })
      return
    }
    if (bytes > MAX_SKILL_DOC_BYTES) {
      sendJson(res, 413, { error: 'skill_doc_too_large', name, limit: MAX_SKILL_DOC_BYTES })
      return
    }
    let body
    try {
      body = readFile(target)
    } catch {
      sendJson(res, 404, { error: 'skill_doc_unreadable', name })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(typeof body === 'string' ? body : Buffer.from(body))
  }
}

/**
 * 卡片那侧拼 URL 的唯一口径（文件名里带 `.` 的 slug 也要能拼，所以走 encodeURIComponent）。
 * 客户端 bundle 与这里是**同一条字符串**的两端：漂移的表现为"详情永远读不到"，由
 * `test/capital-config.test.mjs` 的同字断言钉住（客户端不能 import 本模块 ⇒ 只能对着产物量）。
 */
export function skillDocUrl(name) {
  return `${SKILL_DOC_ROUTE}/${encodeURIComponent(name)}.md`
}

/**
 * 本行消费两件事：自己的配置（schema 事实，见上）与快照原文的读盘旁路。
 *
 * `webServer` 只走 `inject`——`ctx.get('webServer')` 解析得到值**不代表**属性访问合法
 * （cordis 的属性代理只认"本层声明过 inject"），探测式写法会把正确性押在装配顺序上，
 * 这条踩过两次（见 `chart-ui/index.js` 的同一段注释）。认证面 `connection` 反之要**惰性**
 * 解析：它缺席（Electron / file:// 这类没有浏览器认证面的载体）就退化成"没有认证面"的旧行为，
 * 但解析抛错一律 401。
 */
export function apply(ctx) {
  const authorize = (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      return 401
    }
    if (connection === undefined || connection === null) return undefined
    if (typeof connection.requestRejection !== 'function') return undefined
    return connection.requestRejection(req)
  }
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: SKILL_DOC_ROUTE,
        handler: createSkillDocHandler({ authorize }),
      }),
      'capital-config: skill 原文旁路',
    )
  })
  ctx.logger?.info?.('capital-config: settings entry active (volatile config surface + skill 原文旁路)')
}
