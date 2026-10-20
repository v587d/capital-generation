/**
 * Validate tool results against their declared output.schema.
 *
 * The host rejects any mismatch before the model sees a result, while direct execute()
 * calls bypass it. This helper mirrors the host's required/additionalProperties/oneOf rules.
 * `npm run check:dsh` detects whether the host rule still exists.
 */

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function typeViolation(node, value) {
  switch (node.type) {
    case 'object':
      return isPlainRecord(value) ? undefined : 'must be an object'
    case 'array':
      return Array.isArray(value) ? undefined : 'must be an array'
    case 'string':
      return typeof value === 'string' ? undefined : 'must be a string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'must be a finite number'
    case 'integer':
      return Number.isSafeInteger(value) ? undefined : 'must be an integer'
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be a boolean'
    case 'null':
      return value === null ? undefined : 'must be null'
    default:
      return undefined
  }
}

function collect(node, value, path, out) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node.oneOf)) {
    const matched = node.oneOf.filter((branch) => violationsOf(branch, value, path).length === 0)
    if (matched.length !== 1) out.push(`"${path}" must match exactly one oneOf branch (matched ${matched.length})`)
    return
  }
  if (node.type === undefined) return
  const violation = typeViolation(node, value)
  if (violation !== undefined) {
    out.push(`"${path}" ${violation}`)
    return
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) out.push(`"${path}" must be one of ${node.enum.join(', ')}`)
  if (node.type === 'object') {
    const properties = isPlainRecord(node.properties) ? node.properties : {}
    for (const key of Array.isArray(node.required) ? node.required : []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) out.push(`missing required property "${path}.${key}"`)
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) out.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      collect(child, value[key], `${path}.${key}`, out)
    }
    return
  }
  if (node.type === 'array' && node.items !== undefined) {
    value.forEach((entry, index) => collect(node.items, entry, `${path}[${index}]`, out))
  }
}

function violationsOf(schema, value, path) {
  const out = []
  collect(schema, value, path, out)
  return out
}

/** Violations against the declared schema; an empty list means valid. */
export function outputSchemaViolations(schema, value, path = 'value') {
  return violationsOf(schema, value, path)
}

/** Assert that one execute result conforms to its own output schema. */
export function assertToolOutput(definition, value) {
  if (definition?.output?.schema === undefined) return
  const violations = outputSchemaViolations(definition.output.schema, value)
  if (violations.length > 0) {
    throw new Error(`tool "${definition.name}" 的返回值不满足 output.schema（宿主会抛 ToolOutputError）：\n  ${violations.join('\n  ')}`)
  }
}

/** Required properties must be declared recursively. */
export function collectUndeclaredRequired(schema, path = 'value') {
  const out = []
  const walk = (node, where) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node.oneOf)) { node.oneOf.forEach((branch, index) => walk(branch, `${where}.oneOf[${index}]`)); return }
    if (node.type === 'object') {
      const properties = isPlainRecord(node.properties) ? node.properties : {}
      for (const key of Array.isArray(node.required) ? node.required : []) {
        if (!Object.hasOwn(properties, key)) out.push(`${where}.required 含未声明属性 ${key}`)
      }
      for (const [key, child] of Object.entries(properties)) walk(child, `${where}.${key}`)
      return
    }
    if (node.type === 'array' && node.items !== undefined) walk(node.items, `${where}[]`)
  }
  walk(schema, path)
  return out
}
