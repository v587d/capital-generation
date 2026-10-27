/**
 * Error text crossing the storage/wire boundary. Keep the user-readable cause, remove credentials,
 * control bytes and host paths; model/tool payloads never enter this function.
 */
const TOKEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[A-Za-z0-9_-]{32,}\b/g,
]

const PATH_PATTERNS = [
  /(?:[A-Za-z]:\\|\/)(?:[^\s"'`]+[\\/])+[^\s"'`]*/g,
  /~\/[^\s"'`]+/g,
]

export function sanitizeMessage(value) {
  let text = typeof value === 'string' ? value : String(value ?? '')
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  text = text.replace(/\r\n?/g, '\n')
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, '[redacted]')
  for (const pattern of PATH_PATTERNS) text = text.replace(pattern, '[path]')
  const trimmed = text.trim()
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed
}
