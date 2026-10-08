/**
 * 调 api.github.com 的**唯一**一份实现（`AGENTS.md` §9.7）。
 *
 * 为什么不用 `gh` CLI：`gh` 在 Windows 上是 `.cmd` 垫片，按命令名 spawn 会 ENOENT——
 * `test/cross-platform.test.mjs` 就是为这个形状存在的，别绕。更要紧的是发布脚本与看门狗
 * 本来就要干同一件事（列 Issue / 开单 / 改正文 / 关单），写两份就是"配了但只改好一处"的前身。
 *
 * 凭据只从环境读，⛔ 不许出现在任何日志或异常文本里。
 */

const API = 'https://api.github.com'

export class GitHubApiError extends Error {
  // ⚠️ 这里是 .mjs 不是 .ts：`constructor(message, readonly status, …)` 那种 TS 参数属性写法
  // 在 JS 里是语法错，而**只有 CI 会跑到这一份代码**（本地没有任何测试 import 它），
  // 表现是巡检全绿、发单那一步炸——所以别在这里写类型语法。
  constructor(message, status, body) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.body = body
  }
}

/** 缺凭据时抛错而不是静默返回空列表——"查了 0 条然后判定一切正常"是最坏的失效形状。 */
export function requireGitHubEnv() {
  const token = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  if (!token || !repository) {
    throw new GitHubApiError('需要 GITHUB_TOKEN 与 GITHUB_REPOSITORY（由 Actions 注入）', 0)
  }
  return { token, repository }
}

export function createGitHubApi({ token, repository }) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  }
  async function call(method, path, body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    if (!response.ok) {
      // 只带状态码与截断后的响应摘要：GitHub 的错误体里会回显请求头之外的东西，别原样抛。
      throw new GitHubApiError(`${method} ${path} → HTTP ${response.status} ${text.slice(0, 200)}`, response.status, text)
    }
    return text ? JSON.parse(text) : {}
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    repo: repository,
  }
}
