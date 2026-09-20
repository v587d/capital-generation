import { DatasetStoreError } from '../data-collector/store.js';
import { ChartError } from './errors.js';
import { buildStandaloneHtml, loadVendoredChartLibrary } from './html.js';
import { buildChartPayload, extractRows, MAX_CHART_POINTS } from './series.js';
import { normalizeChartSpec } from './spec.js';
import { chartSourceTokenForRender } from './source-token.js';
import { chartSessionScopeId } from './artifact-ref.js';
import { chartTraceEnabled } from './events.js';
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const CHART_ARTIFACT_DIR = 'capital-analysis/charts';
function render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function newChartId() {
    const cryptoLike = globalThis.crypto;
    const suffix = cryptoLike?.randomUUID ? cryptoLike.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `ch_${suffix}`;
}
function sessionOf(exec) {
    const session = exec.agent?.session;
    if (!session || typeof session.id !== 'string' || session.id.length === 0) {
        throw new ChartError('chart_source_invalid', 'the calling agent session was not provided');
    }
    return session;
}
function stripErrorCode(message) {
    const separator = message.indexOf(':');
    return separator >= 0 ? message.slice(separator + 1).trim() : message;
}
function normalizeStoreError(error) {
    if (!(error instanceof DatasetStoreError))
        return undefined;
    const detail = stripErrorCode(error.message);
    switch (error.code) {
        case 'dataset_not_found':
        case 'dataset_expired':
        case 'dataset_session_mismatch':
            return new ChartError('chart_source_not_found', detail, { cause: error.code });
        case 'dataset_id_invalid':
        case 'workspace_path_invalid':
            return new ChartError('chart_source_invalid', detail, { cause: error.code });
        case 'dataset_too_large':
            return new ChartError('chart_too_large', detail, { cause: error.code });
        case 'workspace_file_invalid':
        case 'dataset_not_row_readable':
        case 'dataset_format_unsupported':
            return new ChartError('chart_source_invalid', detail, { cause: error.code });
        case 'workspace_not_writable':
        case 'dataset_write_failed':
            return new ChartError('chart_write_failed', detail, { cause: error.code });
        case 'filesystem_unavailable':
        case 'sandbox_policy_unavailable':
        case 'session_cwd_unavailable':
            return new ChartError('chart_runtime_unavailable', detail, { cause: error.code });
        default:
            return undefined;
    }
}
/**
 * 工具框架对 throw 的错误只保留 message；把 ChartError 的 details 在这里展开成
 * JSON 信封，模型才能拿到 array_keys / available 等一次修正所需的信息。
 */
function toolVisibleError(error) {
    const normalized = error instanceof ChartError ? error : normalizeStoreError(error);
    if (!normalized)
        return error instanceof Error ? error : new Error(String(error));
    const visible = new Error(JSON.stringify(normalized.toEnvelope()));
    visible.name = normalized.name;
    visible.code = normalized.code;
    return visible;
}
const receiptSchema = jsonObject({
    chart_ref: { type: 'string' },
    chart_id: { type: 'string' },
    kind: { type: 'string' },
    axis: { type: 'string', enum: ['time', 'index'] },
    title: { type: 'string' },
    points: { type: 'integer' },
    original_points: { type: 'integer' },
    downsampled: { type: 'boolean' },
    series_labels: { type: 'array', items: { type: 'string' } },
    has_volume: { type: 'boolean' },
    markers: { type: 'integer' },
    dataset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    source_label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    captured_at: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    chart_url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    spec_path: { type: 'string' },
    series_path: { type: 'string' },
    html_path: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
}, [
    'chart_ref', 'chart_id', 'kind', 'axis', 'points', 'original_points', 'downsampled',
    'series_labels', 'has_volume', 'markers', 'dataset_id', 'source_label',
    'captured_at', 'chart_url', 'spec_path', 'series_path', 'html_path', 'warnings',
]);
const parameters = jsonObject({
    dataset_id: { type: 'string', description: '数据来源之一：已授权的 DatasetRef 的 dataset_id（与 path / chart_source_ref 三选一）' },
    path: { type: 'string', description: '数据来源之一：workspace 相对路径的 JSON 文件，如 capital-data/datasets/x/raw.json（与 dataset_id / chart_source_ref 三选一）' },
    chart_source_ref: { type: 'string', description: '数据来源之一：宿主签发给 visualization_specialist 的短期 opaque chart source token（与 dataset_id / path 三选一）' },
    task_id: { type: 'string', description: '使用 chart_source_ref 时必需；必须与 token 绑定的当前任务一致' },
    spec: {
        oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }],
        description: '图表描述对象或 JSON 对象字符串，至少 { kind, x?, series? | ohlc?, volume?, markers?, range?, title? }；字段语义与错误码见 skill capital-chart-protocol',
    },
    title: { type: 'string', description: '可选：覆盖 spec.title 的图表标题' },
}, ['spec']);
export async function renderChart(input, args, exec) {
    const now = input.now ?? (() => Date.now());
    const session = sessionOf(exec);
    const requestedDatasetId = typeof args.dataset_id === 'string' && args.dataset_id.trim().length > 0 ? args.dataset_id.trim() : undefined;
    const path = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined;
    const chartSourceRef = typeof args.chart_source_ref === 'string' && args.chart_source_ref.trim().length > 0 ? args.chart_source_ref.trim() : undefined;
    const sourceCount = [requestedDatasetId, path, chartSourceRef].filter((value) => value !== undefined).length;
    if (sourceCount !== 1) {
        throw new ChartError('chart_source_invalid', 'provide exactly one data source: dataset_id, path, or chart_source_ref');
    }
    if (session.header?.parentSession && chartSourceRef === undefined) {
        throw new ChartError('chart_source_scope_mismatch', 'delegated visualization callers must use chart_source_ref');
    }
    const tokenSource = chartSourceRef === undefined ? undefined : chartSourceTokenForRender(input.sourceTokens, {
        chart_source_ref: chartSourceRef,
        task_id: args.task_id,
    }, session);
    const datasetId = tokenSource?.dataset_id ?? requestedDatasetId;
    const spec = normalizeChartSpec(args.spec);
    if (typeof args.title === 'string' && args.title.trim().length > 0)
        spec.title = args.title.trim().slice(0, 200);
    // ── 取数：两条来源都在宿主进程内完成，rows 不进入任何消息 ────────────────────
    let rows;
    let meta;
    if (datasetId !== undefined) {
        // A chart_source_ref carries the direct data-agent session that already has
        // access to the parent Dataset scope. The nested visualization child is
        // only the caller of render_chart; it never receives raw rows.
        const readSession = tokenSource?.sourceSession ?? session;
        const { ref, rows: datasetRows } = await input.store.readPresentationRows({ session: readSession, dataset_id: datasetId, signal: exec.signal });
        rows = datasetRows;
        meta = { source_kind: 'dataset', dataset_id: ref.dataset_id, source_label: ref.source_label, captured_at: ref.captured_at };
    }
    else {
        const parsed = await input.store.readWorkspaceJson({ session, path: path, signal: exec.signal });
        const extracted = extractRows(parsed);
        rows = extracted.rows;
        meta = { source_kind: 'path' };
    }
    // ── 有界化 ───────────────────────────────────────────────────────────────
    const chartId = newChartId();
    const payload = buildChartPayload({ chart_id: chartId, spec, rows, meta });
    const library = loadVendoredChartLibrary();
    const generatedAt = now();
    const html = buildStandaloneHtml({ payload, library, generatedAt });
    const dir = `${CHART_ARTIFACT_DIR}/${chartId}`;
    const written = await input.store.writeWorkspaceFiles({
        session,
        dir,
        files: [
            { name: 'spec.json', content: `${JSON.stringify({ chart_id: chartId, created_at: generatedAt, source: { dataset_id: meta.dataset_id ?? null, path: path ?? null }, spec }, null, 2)}\n` },
            { name: 'series.json', content: `${JSON.stringify(payload)}\n` },
            { name: 'chart.html', content: html },
        ],
        signal: exec.signal,
    });
    const pathOf = (name) => written.find((file) => file.name === name)?.path ?? `${dir}/${name}`;
    // 序列旁路：把 series.json 的**绝对路径**登记给 host 平面路由，客户端凭 chart_url 取数。
    // 登记失败（服务缺失/实现异常）不阻断出图——图已经落盘了，降级成"只有文件路径"。
    let chartUrl = null;
    const seriesFile = written.find((file) => file.name === 'series.json');
    if (input.charts && seriesFile !== undefined) {
        try {
            chartUrl = input.charts()?.publish({ chartId, filePath: seriesFile.absolutePath }) ?? null;
        }
        catch (error) {
            payload.meta.warnings.push(`序列旁路登记失败（回执只给文件路径）：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const taskId = tokenSource?.task_id
        ?? (typeof args.task_id === 'string' && args.task_id.trim().length > 0 ? args.task_id.trim() : null);
    const artifact = input.artifacts?.issue({
        session: tokenSource?.sourceSession ?? session,
        chart_id: chartId,
        task_id: taskId,
        dataset_id: meta.dataset_id ?? null,
        source_label: meta.source_label ?? null,
        captured_at: meta.captured_at ?? null,
        kind: payload.kind,
        axis: payload.axis,
        chart_url: chartUrl,
        spec_path: pathOf('spec.json'),
        series_path: pathOf('series.json'),
        html_path: pathOf('chart.html'),
        created_at: generatedAt,
    });
    // Direct unit callers that do not install the production registry still get
    // a stable receipt; production apply() always injects the registry.
    const chartRef = artifact?.chart_ref ?? `chart_${chartId.slice(3)}`;
    // 对话流呈现：把这张图登记为**用户正在看的那条会话**的本轮交付物
    // （owner scope 与 chart_ref 同源，因此 specialist 出的图正好落在主会话）。
    // 走官方 `deliverables/presented`——**不能**改回自定义事件类型：会话日志的事件词汇表
    // 是闭集，非 first-party 类型会让整份会话在冷加载时打不开（事故记录见 src/chart/events.ts）。
    // 事件不进模型消息历史。呈现通道可选：写不进去不影响图表产物与回执。
    let deliverableTrace;
    try {
        const publisher = input.chartEvents?.();
        if (publisher === undefined) {
            deliverableTrace = '发布器不可用：chartEvents() 返回 undefined（sessions / sessionProjections 解析不到，或接线异常）';
        }
        else {
            const ownerSessionId = chartSessionScopeId(tokenSource?.sourceSession ?? session);
            const accepted = publisher.publish({
                ownerSessionId,
                chart_id: chartId,
                title: payload.title,
                html_path: pathOf('chart.html'),
            });
            deliverableTrace = `publish=${accepted ? '受理' : '拒绝'} ownerSessionId=${ownerSessionId} | ${publisher.lastTrace?.() ?? '(无轨迹)'}`;
        }
    }
    catch (error) {
        deliverableTrace = `交付登记抛错（已吞掉，不影响出图）：${error instanceof Error ? error.message : String(error)}`;
    }
    // 诊断落盘**默认关闭**：交付行"静默不出现"是最难查的故障（2026-09-20 连查四轮），
    // 而宿主终端不总能拿到（cordis logger 只进内存），所以留一条可从磁盘定位的出口；
    // 但它属于调试产物，不该出现在对外版本的 workspace 里。
    // 需要时用 `CAPITAL_CHART_TRACE=1` 启动宿主，图表产物目录会多出 deliverable-trace.txt。
    if (chartTraceEnabled()) {
        try {
            await input.store.writeWorkspaceFiles({
                session,
                dir,
                files: [{ name: 'deliverable-trace.txt', content: `${deliverableTrace}\n` }],
                signal: exec.signal,
            });
        }
        catch {
            // 诊断落盘失败不影响出图。
        }
    }
    return {
        chart_ref: chartRef,
        chart_id: chartId,
        kind: payload.kind,
        axis: payload.axis,
        title: payload.title,
        points: payload.meta.points,
        original_points: payload.meta.original_points,
        downsampled: payload.meta.downsampled,
        series_labels: payload.series.map((item) => item.label).concat(payload.ohlc ? [payload.ohlc.label] : []),
        has_volume: payload.volume !== undefined,
        markers: payload.markers.length,
        dataset_id: meta.dataset_id ?? null,
        source_label: meta.source_label ?? null,
        captured_at: meta.captured_at ?? null,
        chart_url: chartUrl,
        spec_path: pathOf('spec.json'),
        series_path: pathOf('series.json'),
        html_path: pathOf('chart.html'),
        warnings: payload.meta.warnings,
    };
}
export function registerChartTool(ctx, options) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const definition = {
        name: 'render_chart',
        description: `把已经取到的数据渲染成一张可交互图，产物落在 workspace 的 ${CHART_ARTIFACT_DIR}/<chart_id>/（chart.html 可离线打开）。` +
            '**只回一条小回执，不回任何原始数据行**：序列走旁路，不进入上下文。' +
            '来源三选一：dataset_id（已授权的 DatasetRef）、path（workspace 相对路径的 JSON，支持顶层数组或含行数组的 envelope），或 chart_source_ref（宿主签发给 visualization_specialist 的短期 token；使用它时还要提供 task_id）。' +
            'spec 是自由对象，至少给出 kind（line / area / column / candlestick / bar；后两者要 ohlc 四字段与真实时间列）与字段选择（series 或 ohlc），' +
            `最多保留 ${MAX_CHART_POINTS} 个点（超出由宿主下采样并如实标注）。` +
            '字段语义、可用键与错误码见 skill capital-chart-protocol —— 首次画图前先加载它。' +
            '是否出图由 data_junior 的可视化协议决定；本工具只负责安全生成图表产物和小型回执。' +
            '出图成功后宿主会把这张图登记为当前对话的**本轮交付物**（官方 deliverables/presented），用户可从收尾的交付行点开自包含图表；调用方**不要**在回传或正文里罗列图表文件、路径或 HTML。' +
            '图表是呈现不是分析：需要数值结论（首末值、涨跌幅、分位数等）仍走 data_junior 的 profile / query，不要用图去推断数字。',
        parameters,
        output: { schema: receiptSchema, render },
        async execute(args, exec) {
            try {
                return await renderChart(options, args, exec);
            }
            catch (error) {
                throw toolVisibleError(error);
            }
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(render_chart)');
}
