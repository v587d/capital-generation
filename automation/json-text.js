/**
 * Shared extraction for model-authored JSON. Briefs and TODO verdicts both arrive as an
 * object wrapped in prose or a code fence, and models occasionally leave a trailing comma
 * before `]`/`}`; one implementation keeps both readers on the same rules.
 */

function parseValue(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function stripTrailingCommas(text) {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      continue
    }
    if (char === ',') {
      let next = index + 1
      while (next < text.length && /\s/.test(text[next])) next += 1
      if (text[next] === ']' || text[next] === '}') continue
    }
    output += char
  }
  return output
}

/** Parse any JSON value, retrying once with string-aware trailing-comma removal. */
export function parseJsonValue(text) {
  const direct = parseValue(text)
  if (direct !== undefined) return direct
  return parseValue(stripTrailingCommas(text))
}

/**
 * Narrow a model reply to the JSON text it carries: the last code fence when one exists,
 * otherwise the outermost `{...}` after a prose preamble. Truncated text is returned as-is so
 * the caller can report a parse failure instead of silently accepting half an object.
 */
export function extractJsonText(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').trim()
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)]
  if (fences.length > 0) return fences.at(-1)[1].trim()
  const start = text.indexOf('{')
  if (start < 0) return text
  const end = text.lastIndexOf('}')
  return end > start ? text.slice(start, end + 1) : text.slice(start)
}

/** The extracted reply when it is a JSON object, otherwise undefined. */
export function extractJsonObject(raw) {
  const value = parseJsonValue(extractJsonText(raw))
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}
