import z from '@deepseek-ai/schemastery'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

export const name = 'capital-config'

/**
 * Profile entry id; 0.1.7 makes it the settings namespace itself. The browser half
 * addresses it via `configForms.get(ENTRY_ID)` and the main plugin reads the same
 * entry's `*.credentialRef` names; drift makes the card vanish silently. Every
 * editable field must be `.volatile()` or describe omits it.
 */
export const SETTINGS_ENTRY_ID = 'capital-config'

const WindDocsSchema = z.object({
  endpoint: z.string().default('').volatile().description('可选：覆盖 Wind 文档检索端点'),
  credentialRef: z.string().default('WIND_API_KEY').volatile().description('Wind credentials 引用名'),
  timeoutMs: z.number().default(60000).volatile().description('Wind 请求超时毫秒'),
})

/**
 * Must match `LOCAL_FETCH_DEFAULTS` in `src/index.ts` verbatim (test pins it).
 * `maxContentChars` cuts the pre-conversion HTML, so it is sized by HTML volume.
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
 * Must match `PADDLE_OCR_DEFAULTS` in `src/index.ts` verbatim.
 * `pollBudgetMs: 0` = client default 200000 ms, below the tool's 240000 timeout.
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
  z.boolean().default(false).volatile().description(`Enable ${entry.name} for the Capital role(s) that own it (experimental; default off)`),
]))
const SelectedSkillsSchema = z.object(SelectedSkillsShape)

const SELECTED_SKILL_DEFAULTS = Object.fromEntries(SELECTED_SKILL_CATALOG.map((entry) => [entry.key, false]))

const SelectedSkillsModeSchema = z.union(['manual', 'auto'])
  .default('manual')
  .volatile()
  .description('manual = 只用用户勾选；auto = 按角色开放全部方法，运行期忽略勾选')

export const Config = z.object({
  customPersona: z.string().default('').volatile().description('自动模式附加人设文本'),
  selectedSkillsMode: SelectedSkillsModeSchema,
  selectedSkills: SelectedSkillsSchema.default(SELECTED_SKILL_DEFAULTS).description('Explicitly selected community methods; default off, each visible only to the Capital role(s) that own it'),
  fuyaoCredentialRef: z.string().default('FUYAO_API_KEY').volatile().description('Fuyao credentials 引用名'),
  ftshareCredentialRef: z.string().default('FTSHARE_API_KEY').volatile().description('FTShare（非凸科技）credentials 引用名'),
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
 * Read-only route for the "Selected Skills" detail hover: serves the packaged
 * SKILL.md snapshot from disk instead of shipping ~750 KB in the client bundle.
 * Request names only index a precomputed Map (never path fragments). Same auth
 * fence as `/capital-charts` (`requestRejection`).
 */
export const SKILL_DOC_ROUTE = '/capital-skills'
/** Byte cap per document: oversized files are rejected whole, never truncated. */
export const MAX_SKILL_DOC_BYTES = 128 * 1024

const SKILL_DOC_SUFFIX = 'SKILL.md'

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

/** `options.authorize` = `(req) => 401 | 403 | undefined`; non-empty rejects without touching fs. */
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
        // Fail closed: an authorizer that cannot answer must not mean "no auth".
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
      // Snapshot missing from the package: say unreadable, never an empty document.
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

/** URL built identically in the client bundle; drift = details never load (test pins both). */
export function skillDocUrl(name) {
  return `${SKILL_DOC_ROUTE}/${encodeURIComponent(name)}.md`
}

/**
 * `webServer` only via inject (probing `ctx.webServer` bets on mount order);
 * `connection` resolved lazily: absent = no auth plane, throwing = 401.
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
