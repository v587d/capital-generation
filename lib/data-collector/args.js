import { DatasetStoreError } from './store.js';
/**
 * Dataset 工具边界的**宽容参数解析**。
 *
 * 模型经常把数组/对象参数序列化成 JSON 字符串再传（实测：`"select": "[\"date_ms\"]"`、
 * `"group_by": "[]"`、`"aggregates": "[{...}]"`、`"limit": "1"`），于是参数其实是对的，
 * 却报 `query_spec_invalid: select must contain 1-32 column names`，模型只能反复试错。
 *
 * 这里在**工具边界**做一次宽容解析，查询引擎本身保持严格：能解析成正确类型就放行，
 * 解析不了就原样交给校验器报错（错误信息仍指向真实问题）。
 *
 * 本模块由 `query_dataset`（dataset-tools.ts）与 `describe_dataset`（describe.ts）共用，
 * 保证两个工具对同一种"字符串化的 JSON"给出**完全一致**的宽容度——两份实现漂移会让模型
 * 在换工具后重新踩同一个坑。
 */
export function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function parseJsonContainer(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text.length === 0 || (text[0] !== '[' && text[0] !== '{'))
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/** 列名数组：接受真数组、JSON 数组字符串，或单个列名字符串。 */
export function coerceNameList(value) {
    if (Array.isArray(value))
        return value;
    const parsed = parseJsonContainer(value);
    if (Array.isArray(parsed))
        return parsed;
    if (typeof value === 'string' && parsed === undefined) {
        const text = value.trim();
        if (text.length > 0 && !text.startsWith('[') && !text.startsWith('{'))
            return [value];
    }
    return value;
}
/** 对象数组：接受真数组、JSON 数组字符串，或单个对象（对象本身或其 JSON 字符串）。 */
export function coerceObjectList(value) {
    if (Array.isArray(value))
        return value;
    const parsed = parseJsonContainer(value);
    if (Array.isArray(parsed))
        return parsed;
    if (isRecord(parsed))
        return [parsed];
    if (isRecord(value))
        return [value];
    return value;
}
export function coerceLimit(value) {
    if (typeof value !== 'string')
        return value;
    const text = value.trim();
    return /^\d+$/.test(text) ? Number(text) : value;
}
export const QUERY_NAME_LIST_FIELDS = ['select', 'group_by'];
export const QUERY_OBJECT_LIST_FIELDS = ['filters', 'aggregates', 'order_by'];
/** 把 QuerySpec 的数组/对象字段与 limit 统一解析成引擎期望的类型（不改其余字段）。 */
export function coerceQueryShape(input) {
    const shape = { ...input };
    for (const field of QUERY_NAME_LIST_FIELDS)
        if (field in shape)
            shape[field] = coerceNameList(shape[field]);
    for (const field of QUERY_OBJECT_LIST_FIELDS)
        if (field in shape)
            shape[field] = coerceObjectList(shape[field]);
    if ('limit' in shape)
        shape.limit = coerceLimit(shape.limit);
    return shape;
}
/** dataset_id 的形态校验；不合法一律在工具边界抛错，绝不带进 store。 */
export function readDatasetId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new DatasetStoreError('dataset_id_invalid', 'dataset_id is invalid');
    }
    return value;
}
/** task_id 是可选元数据：空值等同于未提供，只做长度上限校验。 */
export function readOptionalTaskId(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || value.length > 256) {
        throw new DatasetStoreError('profile_invalid', 'task_id is invalid');
    }
    return value;
}
/** 可选的字符串参数（time_column / primary_key）：非字符串一律视为未提供。 */
export function readOptionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/**
 * 列名过滤参数（describe_dataset 的 `columns_of_interest`）。
 *
 * 接受真数组 / JSON 数组字符串 / 单个列名字符串；解析结果不是数组就抛错——静默忽略一个
 * 写错的过滤条件会让模型以为"结果已经收窄"，而实际返回的是全量（或反过来），所以这里响亮失败。
 */
export function readOptionalColumnList(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const coerced = coerceNameList(value);
    if (!Array.isArray(coerced) || coerced.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 128)) {
        throw new DatasetStoreError('profile_invalid', 'columns_of_interest must be an array of column names');
    }
    return [...new Set(coerced)];
}
