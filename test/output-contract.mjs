/**
 * 工具**输出契约**断言：返回值必须满足工具自己声明的 `output.schema`。
 *
 * 为什么需要它（2026-09-23 真机事故，会话 `cf464cb6`）：宿主 `dsh-tools` 的
 * `createSuccessResult` 会先 `snapshotToolValue` 再
 * `validateJsonSchemaValue(tool.output.schema, detached, "value")`，任何违反都抛
 * `ToolOutputError: tool "<name>" returned invalid output: ...`，**整次调用作废**。
 * 而 test 里直接调 `definition.execute(...)` **完全绕过这一层**——于是
 * `resolve_data_time_range` 的 capability 形态（返回里没有 `mode`）在本地全绿、
 * 真机上每次调用都失败，模型只看到一句 invalid output，重试了 3 次同一条调用。
 *
 * 这份实现是宿主规则的**镜像**（与 `assertLosslessJson` 同型：宿主规则进测试，不靠人记）：
 * 逐条对应 `dsh-tools/lib/types/json-schema.js` 的 `validateJsonSchemaValue`——
 * `required` 必须存在且非 undefined、`additionalProperties: false` 拒绝未声明字段、
 * `oneOf` 必须**恰好**匹配一支。它比宿主宽松的地方（`format` / `minimum` / `pattern`
 * 未实现）不会造成漏报本类事故：本类事故的形状是"字段缺失 / 多余"。
 *
 * 与之配套的**上游探针**在 `npm run check:dsh`（账本 L16）：一旦上游不再按
 * `output.schema` 校验返回值，这条镜像就该跟着退休，探针会点名。
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

/** 返回违反声明的条目（空数组 = 合规）。 */
export function outputSchemaViolations(schema, value, path = 'value') {
  return violationsOf(schema, value, path)
}

/** 断言一次工具调用的返回值满足它自己声明的 output.schema。 */
export function assertToolOutput(definition, value) {
  if (definition?.output?.schema === undefined) return
  const violations = outputSchemaViolations(definition.output.schema, value)
  if (violations.length > 0) {
    throw new Error(`tool "${definition.name}" 的返回值不满足 output.schema（宿主会抛 ToolOutputError）：\n  ${violations.join('\n  ')}`)
  }
}

/** 结构不变量：`required` 里的每个键都必须在 `properties` 里声明过（递归检查）。 */
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
