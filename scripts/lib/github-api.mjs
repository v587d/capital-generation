/**
 * The single implementation of api.github.com calls (AGENTS.md §9.7).
 * Don't spawn gh: on Windows it is a .cmd shim, and name-spawn yields ENOENT or EINVAL
 * (test/cross-platform.test.mjs exists for that shape). Credentials come from env only and
 * ⛔ must never reach logs or error text.
 */

const API = 'https://api.github.com'

export class GitHubApiError extends Error {
  // Plain .mjs: TS parameter properties are a syntax error here, and only CI ever runs this file.
  constructor(message, status, body) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.body = body
  }
}

/** Missing credentials must throw, never return an empty list: "checked 0 and called it fine". */
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
      // Status plus a truncated body only; never rethrow the whole response.
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
