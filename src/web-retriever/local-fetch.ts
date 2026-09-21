/**
 * SSRF-gated local HTTP fetcher used after AnySearch extraction fails.
 *
 * Known limitation: DNS is resolved before each request, but the resolved IP is
 * not pinned into the subsequent HTTP connection. A DNS rebinding window remains
 * between validation and connect. Closing that window would require a custom
 * dispatcher; this module keeps the same explicit trade-off as dsh-search-first.
 */

import { htmlToMarkdown } from './html-markdown.js'

export const LOCAL_FETCH_CLIENT_VERSION = '2.1.0'
export const LOCAL_FETCH_MAX_URL_LENGTH = 2048

export type LocalFetchErrorCode =
  | 'ABORTED'
  | 'TIMEOUT'
  | 'INVALID_URL'
  | 'BLOCKED_URL'
  | 'DNS'
  | 'REDIRECT'
  | 'HTTP'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'

export class LocalFetchError extends Error {
  constructor(readonly code: LocalFetchErrorCode, message: string) {
    super(message)
    this.name = 'LocalFetchError'
  }
}

export interface LocalFetchOptions {
  timeoutMs: number
  maxBytes: number
  maxContentChars: number
  maxRedirects: number
  userAgent: string
  allowPrivate?: boolean
  resolveAddresses?: (
    hostname: string,
    signal: AbortSignal,
  ) => Promise<Array<{ address: string; family: number }>>
}

export interface LocalFetchOutcome {
  url: string
  status: number
  title?: string
  markdown: string
  truncated: boolean
}

interface DnsLookupLike {
  lookup(
    hostname: string,
    options: { all: true; order: 'verbatim' },
  ): Promise<Array<{ address: string; family: number }>>
}

class OperationAborted extends Error {}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const ACCEPT_HEADER = 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return -1
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : -1
  })
  return values.some((value) => value < 0) ? null : values as [number, number, number, number]
}

function parseIpv6(address: string): number[] | null {
  let input = address.toLowerCase()
  if (input.includes('%')) return null

  if (input.includes('.')) {
    const separator = input.lastIndexOf(':')
    if (separator < 0) return null
    const ipv4 = parseIpv4(input.slice(separator + 1))
    if (ipv4 === null) return null
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16)
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16)
    input = `${input.slice(0, separator)}:${high}:${low}`
  }

  const compression = input.indexOf('::')
  if (compression !== -1 && input.indexOf('::', compression + 2) !== -1) return null
  const parseGroups = (part: string): number[] => {
    if (part === '') return []
    const groups = part.split(':')
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return []
    return groups.map((group) => Number.parseInt(group, 16))
  }

  if (compression === -1) {
    const groups = parseGroups(input)
    return groups.length === 8 ? groups : null
  }

  const left = parseGroups(input.slice(0, compression))
  const right = parseGroups(input.slice(compression + 2))
  if (left.length + right.length >= 8) return null
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right]
}

function isPrivateIpv4(address: [number, number, number, number]): boolean {
  const [first, second, third] = address
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
}

/** Return true only for an address safe to use as a public outbound target. */
export function isPublicIp(address: string): boolean {
  const ipv4 = parseIpv4(address)
  if (ipv4 !== null) return !isPrivateIpv4(ipv4)

  const groups = parseIpv6(address)
  if (groups === null) return false
  if (groups.every((group) => group === 0)) return false
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false

  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (isMappedIpv4) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return !isPrivateIpv4(parseIpv4(mapped) as [number, number, number, number])
  }

  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return false
  if ((first & 0xffc0) === 0xfe80) return false
  if ((first & 0xff00) === 0xff00) return false
  return true
}

function hostnameOf(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
}

function isIpLiteral(hostname: string): boolean {
  return parseIpv4(hostname) !== null || parseIpv6(hostname) !== null
}

function validateUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > LOCAL_FETCH_MAX_URL_LENGTH) {
    throw new LocalFetchError('INVALID_URL', `URL must be at most ${LOCAL_FETCH_MAX_URL_LENGTH} characters`)
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new LocalFetchError('INVALID_URL', 'invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalFetchError('INVALID_URL', 'URL must use http or https')
  }
  if (url.username || url.password) {
    throw new LocalFetchError('INVALID_URL', 'URL credentials are not allowed')
  }
  return url
}

function getDns(): DnsLookupLike | undefined {
  const processLike = (globalThis as {
    process?: { getBuiltinModule?: (id: string) => unknown }
  }).process
  return processLike?.getBuiltinModule?.('node:dns/promises') as DnsLookupLike | undefined
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new OperationAborted())
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new OperationAborted())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

async function defaultResolveAddresses(hostname: string, signal: AbortSignal) {
  const dns = getDns()
  if (!dns || typeof dns.lookup !== 'function') {
    throw new LocalFetchError('DNS', 'DNS resolver is unavailable')
  }
  try {
    return await waitForAbort(dns.lookup(hostname, { all: true, order: 'verbatim' }), signal)
  } catch (error) {
    if (error instanceof OperationAborted) throw error
    throw new LocalFetchError('DNS', `DNS lookup failed for ${hostname}: ${errorText(error)}`)
  }
}

async function assertAllowedHost(
  url: URL,
  options: LocalFetchOptions,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new OperationAborted()
  const hostname = hostnameOf(url)
  if (isIpLiteral(hostname)) {
    if (!options.allowPrivate && !isPublicIp(hostname)) {
      throw new LocalFetchError('BLOCKED_URL', `private or reserved IP is not allowed: ${hostname}`)
    }
    return
  }

  const resolve = options.resolveAddresses ?? defaultResolveAddresses
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await waitForAbort(resolve(hostname, signal), signal)
  } catch (error) {
    if (error instanceof OperationAborted) throw error
    if (error instanceof LocalFetchError) throw error
    throw new LocalFetchError('DNS', `DNS lookup failed for ${hostname}: ${errorText(error)}`)
  }
  if (addresses.length === 0) throw new LocalFetchError('DNS', `DNS lookup returned no addresses for ${hostname}`)
  if (!options.allowPrivate && addresses.some(({ address }) => !isPublicIp(address))) {
    throw new LocalFetchError('BLOCKED_URL', `DNS result for ${hostname} contains a private or reserved address`)
  }
}

function contentType(response: Response): { mime: string; charset?: string } {
  const header = response.headers.get('content-type') ?? ''
  const [rawMime] = header.split(';', 1)
  const mime = rawMime.trim().toLowerCase()
  const charsetMatch = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/iu.exec(header)
  return { mime, charset: charsetMatch?.[1] ?? charsetMatch?.[2] }
}

function isSupportedContentType(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/xhtml+xml'
    || mime === 'application/json'
    || mime === 'application/xml'
    || mime.endsWith('+json')
    || mime.endsWith('+xml')
}

function createDecoder(charset: string | undefined): TextDecoder {
  try {
    return new TextDecoder(charset || 'utf-8')
  } catch {
    throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', `unsupported charset: ${charset ?? '(default)'}`)
  }
}

interface ReadBodyResult {
  text: string
  byteTruncated: boolean
  charTruncated: boolean
}

async function readBody(
  response: Response,
  charset: string | undefined,
  maxBytes: number,
  maxContentChars: number,
  signal: AbortSignal,
): Promise<ReadBodyResult> {
  const decoder = createDecoder(charset)
  const chunks: string[] = []
  let totalBytes = 0
  let byteTruncated = false

  const consume = (chunk: Uint8Array): void => {
    const remaining = Math.max(0, maxBytes - totalBytes)
    if (chunk.byteLength > remaining) {
      if (remaining > 0) chunks.push(decoder.decode(chunk.slice(0, remaining), { stream: true }))
      totalBytes = maxBytes
      byteTruncated = true
      return
    }
    totalBytes += chunk.byteLength
    chunks.push(decoder.decode(chunk, { stream: true }))
  }

  const body = response.body
  if (body !== null) {
    const reader = body.getReader()
    try {
      while (true) {
        if (signal.aborted) throw new OperationAborted()
        const item = await waitForAbort(reader.read(), signal)
        if (item.done) break
        consume(item.value)
        if (byteTruncated) {
          try {
            await reader.cancel()
          } catch {
            // The byte limit has already been enforced; a cancellation failure is harmless.
          }
          break
        }
      }
    } finally {
      reader.releaseLock?.()
    }
  } else if (typeof response.text === 'function') {
    const text = await waitForAbort(response.text(), signal)
    consume(new TextEncoder().encode(text))
  }

  const decoded = byteTruncated ? chunks.join('') : chunks.join('') + decoder.decode()
  const charTruncated = decoded.length > maxContentChars
  return {
    text: charTruncated ? decoded.slice(0, maxContentChars) : decoded,
    byteTruncated,
    charTruncated,
  }
}

export function createLocalFetcher(options: LocalFetchOptions): {
  fetch(url: string, signal?: AbortSignal): Promise<LocalFetchOutcome>
} {
  async function fetchLocal(input: string, callerSignal?: AbortSignal): Promise<LocalFetchOutcome> {
    if (callerSignal?.aborted) throw new LocalFetchError('ABORTED', 'request aborted')

    const controller = new AbortController()
    let timedOut = false
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)

    try {
      let current = validateUrl(input)
      let redirects = 0
      while (true) {
        if (callerSignal?.aborted) throw new LocalFetchError('ABORTED', 'request aborted')
        if (controller.signal.aborted) throw new OperationAborted()
        await assertAllowedHost(current, options, controller.signal)
        if (callerSignal?.aborted) throw new LocalFetchError('ABORTED', 'request aborted')

        let response: Response
        try {
          response = await waitForAbort(globalThis.fetch(current.toString(), {
            method: 'GET',
            redirect: 'manual',
            headers: {
              'user-agent': options.userAgent,
              accept: ACCEPT_HEADER,
            },
            signal: controller.signal,
          }), controller.signal)
        } catch (error) {
          if (error instanceof OperationAborted) throw error
          throw new LocalFetchError('HTTP', `local fetch failed: ${errorText(error)}`)
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          if (redirects >= options.maxRedirects) {
            throw new LocalFetchError('REDIRECT', `redirect limit exceeded (${options.maxRedirects})`)
          }
          const location = response.headers.get('location')
          if (!location) throw new LocalFetchError('REDIRECT', 'redirect response has no Location header')
          try {
            current = validateUrl(new URL(location, current).toString())
          } catch (error) {
            if (error instanceof LocalFetchError && error.code === 'INVALID_URL') {
              throw new LocalFetchError('REDIRECT', `invalid redirect target: ${error.message}`)
            }
            throw new LocalFetchError('REDIRECT', `invalid redirect target: ${errorText(error)}`)
          }
          redirects += 1
          continue
        }

        if (response.status >= 400) {
          throw new LocalFetchError('HTTP', `local fetch returned HTTP ${response.status}`)
        }
        const type = contentType(response)
        if (!isSupportedContentType(type.mime)) {
          throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', `unsupported content type: ${type.mime || '(missing)'}`)
        }
        const body = await readBody(
          response,
          type.charset,
          options.maxBytes,
          options.maxContentChars,
          controller.signal,
        )
        const rendered = htmlToMarkdown(body.text, options.maxContentChars)
        return {
          url: current.toString(),
          status: response.status,
          ...(rendered.title !== undefined ? { title: rendered.title } : {}),
          markdown: rendered.markdown,
          truncated: body.byteTruncated || body.charTruncated || rendered.truncated || rendered.omitted,
        }
      }
    } catch (error) {
      if (error instanceof OperationAborted) {
        if (callerSignal?.aborted) throw new LocalFetchError('ABORTED', 'request aborted')
        if (timedOut) throw new LocalFetchError('TIMEOUT', 'local fetch timed out')
        throw new LocalFetchError('ABORTED', 'request aborted')
      }
      throw error
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  return { fetch: fetchLocal }
}
