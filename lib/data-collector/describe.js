import { DatasetStoreError, } from './store.js';
import { DatasetQueryError } from './query.js';
import { normalizeQueryDates, withIsoTimeColumns } from './query-time.js';
import { coerceQueryShape, isRecord, parseJsonContainer, readDatasetId, readOptionalColumnList, readOptionalString, readOptionalTaskId, } from './args.js';
/**
 * `describe_dataset`：把「inspect_dataset → profile_dataset →（可选）query_dataset」三次调用
 * 合成**一次**（每份 Dataset 一次），供 data_junior 使用。
 *
 * 设计要点（完整理由见 docs/design/describe-dataset-design.md）：
 *
 * 1. **一次调用只处理一个 dataset**。多个 dataset 由模型在**同一条 assistant 消息**里发多个
 *    调用完成——工具声明了 `isConcurrencySafe`，框架会把它们放进并发池，N 份结果在同一个
 *    下一步一起返回。因此**不需要**把 N 份结果合并成一个超长载荷，也就不需要任何
 *    digest / 公平份额 / 裁剪阶梯：单份结果的体积与今天"inspect + profile 两次结果之和"同量级。
 * 2. **形状分支由宿主做**：document 型 Dataset 直接跳过 queries，不再依赖模型先 inspect 再判断。
 * 3. **唯一的体积闸门** {@link SAFE_RESULT_CHARS}：序列化后超过它就不返回超长载荷，改返回
 *    一个小回执（含全部列名与 profile_ref），让模型用 `columns_of_interest` 收窄后重发。
 *    把"剪枝器静默截断"变成"响亮且可操作的重试"，而不是在宿主里做内容改写。
 * 4. **不碰读权限**：一切仍走 store 的受控方法，原始 rows 不进任何 Agent 上下文。
 */
/**
 * 单份结果的码点上限。preset 的工具结果剪枝阈值是 8192（head 4096 + tail 1024，按码点），
 * 这里取 7000 留出余量：超过 8192 会被剪掉中间段，而"被剪"与"被本闸门拦下"的区别是
 * **后者会让模型知道发生了什么并给出重试办法**。
 */
export const SAFE_RESULT_CHARS = 7_000;
/** 单次调用的 queries 条数上限：防的是请求体积，不是结果体积（结果另有闸门）。 */
export const MAX_DESCRIBE_QUERIES = 8;
function errorEnvelope(error) {
    if (error instanceof DatasetQueryError || error instanceof DatasetStoreError) {
        const prefix = `${error.code}: `;
        return { code: error.code, detail: error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message };
    }
    return { code: 'query_failed', detail: error instanceof Error ? error.message : String(error) };
}
/** 与剪枝器同口径：按 Unicode 码点量体积，不按 UTF-16 码元。 */
function codePointLength(text) {
    return [...text].length;
}
/**
 * 丢掉值为 `undefined` 的自有属性。
 *
 * ⛔ 这是**必须**的收尾步骤，不是风格问题（2026-09-23 真机事故）：
 * DSH 用 `snapshotJsonValue`（`@deepseek-ai/dsh-util-values`）校验工具的**返回值**，
 * 规则是"无损 JSON"——任何自有属性值为 `undefined`（以及 NaN/Infinity/-0、数组空洞、
 * 非 plain 对象）都会让 `walkJsonValue` 返回 undefined，宿主随即抛
 * `ToolOutputError: tool "describe_dataset" returned invalid output: value is not lossless JSON`，
 * **整次调用作废**。
 *
 * 而 `JSON.stringify` 会**静默丢掉** undefined 属性，所以本地怎么自测都看不出来。
 * 实测（真机会话 42f42c9e）：同一批 5 次调用里 3 次失败——全是数值列的日线缺
 * `categories`、无数值列的 ticker_search 缺 `statistics`；而 quote 与 corporate_actions
 * 恰好两类列都有，所以成功。模型只看到一句"invalid output"，误判成列名不匹配，
 * 重试一次后回退到 inspect/profile 老路。
 *
 * `store.ts` 的 `buildProfile` 一直用"条件展开"（`...(有内容 ? { statistics } : {})`）避开这个坑；
 * 这里改成**单一收尾闸门**：内部怎么组装都行，出工具前一律过 `compact()`。
 * 回归断言见 test/describe-dataset.test.mjs 的 `assertLosslessJson()`。
 */
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function normalizeQueryItem(value, index, datasetId) {
    if (!isRecord(value))
        throw new DatasetQueryError('query_spec_invalid', `queries[${index}] must be an object`);
    let source = value;
    if (value.query !== undefined) {
        const envelope = isRecord(value.query) ? value.query : parseJsonContainer(value.query);
        if (!isRecord(envelope))
            throw new DatasetQueryError('query_spec_invalid', `queries[${index}].query must be an object`);
        source = envelope;
    }
    if (source.dataset_id !== undefined && source.dataset_id !== datasetId) {
        throw new DatasetQueryError('query_spec_invalid', `queries[${index}].dataset_id must match the describe_dataset dataset_id`);
    }
    const shape = coerceQueryShape(source);
    // envelope 与消息元数据不属于 QuerySpec；dataset_id 由管线按当前 dataset 补。
    for (const field of ['type', 'task_id', 'dataset_id'])
        delete shape[field];
    return shape;
}
/**
 * 工具边界归一化：宽容解析（字符串化的 JSON 数组/对象、单个对象、envelope 形态），
 * 引擎侧保持严格。与 `query_dataset` 的 `normalizeQueryArgs` 共用同一套解析原语
 * （src/data-collector/args.ts），避免两个工具的宽容度漂移。
 */
export function normalizeDescribeArgs(args) {
    const dataset_id = readDatasetId(args.dataset_id);
    const rawQueries = args.queries;
    let list = [];
    if (rawQueries !== undefined && rawQueries !== null && rawQueries !== '') {
        const parsed = parseJsonContainer(rawQueries);
        if (Array.isArray(rawQueries))
            list = rawQueries;
        else if (Array.isArray(parsed))
            list = parsed;
        else if (isRecord(rawQueries))
            list = [rawQueries];
        else if (isRecord(parsed))
            list = [parsed];
        else
            throw new DatasetQueryError('query_spec_invalid', 'queries must be an array of QuerySpec objects (a JSON array string is also accepted)');
    }
    if (list.length > MAX_DESCRIBE_QUERIES) {
        throw new DatasetQueryError('query_spec_invalid', `queries must contain at most ${MAX_DESCRIBE_QUERIES} items`);
    }
    return {
        dataset_id,
        task_id: readOptionalTaskId(args.task_id),
        time_column: readOptionalString(args.time_column),
        primary_key: readOptionalString(args.primary_key),
        columns_of_interest: readOptionalColumnList(args.columns_of_interest),
        queries: list.map((item, index) => normalizeQueryItem(item, index, dataset_id)),
    };
}
function restrictFacts(profile, columns, shape, warnings) {
    const facts = { statistics: profile.statistics, categories: profile.categories, schema: profile.schema };
    if (columns === undefined || columns.length === 0)
        return facts;
    if (shape === 'document') {
        warnings.push('columns_of_interest has no effect on a document Dataset');
        return facts;
    }
    const known = new Set(profile.columns);
    const unknown = columns.filter((column) => !known.has(column));
    if (unknown.length > 0)
        warnings.push(`columns_of_interest ignored unknown columns: ${unknown.join(', ')}`);
    const keep = new Set(columns.filter((column) => known.has(column)));
    const pick = (map) => map === undefined
        ? undefined
        : Object.fromEntries(Object.entries(map).filter(([column]) => keep.has(column)));
    return { statistics: pick(profile.statistics), categories: pick(profile.categories), schema: pick(profile.schema), keep };
}
/**
 * `time_facts.first` / `last` 也按 `columns_of_interest` 收窄。
 *
 * 为什么不收窄是错的：该参数承诺"只对这些列返回事实"，而首末行投影**每个数值列都带一份**
 * （7 列日线 = 每个投影 7 个键），是 time_facts 里最占体积的部分。时间列本身永远保留：
 * 它是首末值的时间坐标，删了这两个投影就没有意义（实测整份 describe 里 time_facts 占 1320 字符）。
 */
function restrictTimeFacts(facts, keep) {
    if (facts === undefined || keep === undefined)
        return facts;
    const pick = (row) => Object.fromEntries(Object.entries(row).filter(([column]) => column === facts.time_column || keep.has(column)));
    return { ...facts, first: pick(facts.first), last: pick(facts.last) };
}
/**
 * 单份 Dataset 的完整管线。失败一律抛错（`isError`）：单 dataset 调用里没有"部分成功"，
 * 把失败做成成功信封会让会话日志无法区分（见 docs/design/tool-result-error-signal.md）。
 */
export async function describeDataset(input) {
    const { store, session, request, signal } = input;
    const inspection = await store.inspectDataset(request.dataset_id, session, signal);
    if (!inspection.query_access.readable) {
        const reason = inspection.query_access.reason;
        const code = reason === 'dataset_too_large' ? 'dataset_too_large' : 'dataset_not_row_readable';
        throw new DatasetStoreError(code, `Dataset ${inspection.dataset_id} cannot be read for description (${reason ?? 'none'})`);
    }
    const profile = await store.profileDataset({
        session,
        dataset_id: inspection.dataset_id,
        task_id: request.task_id,
        time_column: request.time_column,
        primary_key: request.primary_key,
        signal,
    });
    const shape = inspection.query_access.shape;
    const warnings = [...profile.warnings];
    const queries = [];
    if (shape === 'document') {
        if (request.queries.length > 0)
            warnings.push('document Dataset has no row array; queries were not executed');
    }
    else {
        // 内嵌 queries 与 `query_dataset` 必须**完全同构**（同一份 query-time 归一）：
        // 曾经这里直连引擎，于是同一个回合里 `query_dataset` 的日期串能用、内嵌的却把
        // `">=": "2026"` 当数字 2026 比（全中 243 行）、`">=": "2026-07"` 被整条跳过（0 行）。
        // 时间列优先用请求里显式指定的，其次用 profile 已经认出来的那个。
        const axisColumn = request.time_column ?? profile.time_facts?.time_column;
        for (const [index, query] of request.queries.entries()) {
            try {
                const prepared = await normalizeQueryDates({
                    store,
                    session,
                    dataset_id: inspection.dataset_id,
                    query: { ...query, dataset_id: inspection.dataset_id },
                    ...(axisColumn === undefined ? {} : { time_column: axisColumn }),
                    signal,
                });
                const result = await store.queryDataset({
                    session,
                    dataset_id: inspection.dataset_id,
                    query: prepared.query,
                    signal,
                });
                if (prepared.axis !== undefined)
                    withIsoTimeColumns(result, prepared.axis);
                queries.push({ index, result });
            }
            catch (error) {
                // 单条 query 失败不炸整份：把错误记在该条上，模型可以在下一次调用里修正。
                queries.push({ index, error: errorEnvelope(error) });
            }
        }
    }
    const facts = restrictFacts(profile, request.columns_of_interest, shape, warnings);
    // 内部按"该有就有、没有就是 undefined"组装，**出工具前统一过 compact()**：
    // undefined 属性会被 DSH 的输出校验判成 `value is not lossless JSON`（见 compact 注释）。
    const value = compact({
        status: 'ok',
        // 来自 inspect_dataset 的元数据。**刻意不带 DatasetRef.schema**：它与 profile 的逐列 schema
        // 同名不同义，带上既会撞名、又会让宽表体积翻倍；逐列事实已由 profile.schema 覆盖。
        dataset_id: inspection.dataset_id,
        task_id: inspection.task_id,
        session_id: inspection.session_id,
        artifact_ref: inspection.artifact_ref,
        format: inspection.format,
        capability: inspection.capability,
        source_label: inspection.source_label,
        row_count: profile.row_count,
        captured_at: inspection.captured_at,
        retention_until: inspection.retention_until,
        params_digest: inspection.params_digest,
        query_access: inspection.query_access,
        // 来自 profile_dataset
        profile_id: profile.profile_id,
        profile_ref: profile.artifact_ref,
        columns: profile.columns,
        quality: profile.quality,
        statistics: facts.statistics,
        categories: facts.categories,
        schema: facts.schema,
        time_facts: restrictTimeFacts(profile.time_facts, facts.keep),
        structure: profile.structure,
        document: profile.document,
        validation: profile.validation,
        warnings,
        queries,
    });
    const encoded = JSON.stringify(value);
    const bytes = codePointLength(encoded);
    if (bytes > SAFE_RESULT_CHARS) {
        return compact({
            status: 'too_large',
            dataset_id: inspection.dataset_id,
            profile_ref: profile.artifact_ref,
            shape,
            columns: profile.columns,
            bytes,
            hint: shape === 'document'
                ? '文档型 Dataset 的结果超预算：直接调 profile_dataset 取有界内容（本工具的列过滤对文档无效）'
                : '结果超预算：重发一次 describe_dataset，用 columns_of_interest 指定本次问题真正需要的列，或减少 queries 条数',
        });
    }
    return value;
}
