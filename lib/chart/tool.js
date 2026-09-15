import { ChartError } from './errors.js';
import { buildStandaloneHtml, loadVendoredChartLibrary } from './html.js';
import { buildChartPayload, extractRows, MAX_CHART_POINTS } from './series.js';
import { normalizeChartSpec } from './spec.js';
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
const receiptSchema = jsonObject({
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
    'chart_id', 'kind', 'axis', 'points', 'original_points', 'downsampled',
    'series_labels', 'has_volume', 'markers', 'dataset_id', 'source_label',
    'captured_at', 'chart_url', 'spec_path', 'series_path', 'html_path', 'warnings',
]);
const parameters = jsonObject({
    dataset_id: { type: 'string', description: '数据来源之一：已授权的 DatasetRef 的 dataset_id（与 path 二选一）' },
    path: { type: 'string', description: '数据来源之一：workspace 相对路径的 JSON 文件，如 capital-data/datasets/x/raw.json（与 dataset_id 二选一）' },
    spec: {
        type: 'object',
        additionalProperties: true,
        description: '图表描述，至少 { kind, x?, series? | ohlc?, volume?, markers?, range?, title? }；字段语义与错误码见 skill capital-chart-protocol',
    },
    title: { type: 'string', description: '可选：覆盖 spec.title 的图表标题' },
}, ['spec']);
export async function renderChart(input, args, exec) {
    const now = input.now ?? (() => Date.now());
    const session = sessionOf(exec);
    const datasetId = typeof args.dataset_id === 'string' && args.dataset_id.trim().length > 0 ? args.dataset_id.trim() : undefined;
    const path = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined;
    if ((datasetId === undefined) === (path === undefined)) {
        throw new ChartError('chart_source_invalid', 'provide exactly one data source: dataset_id (an authorized DatasetRef) or path (a workspace-relative JSON file)');
    }
    const spec = normalizeChartSpec(args.spec);
    if (typeof args.title === 'string' && args.title.trim().length > 0)
        spec.title = args.title.trim().slice(0, 200);
    // ── 取数：两条来源都在宿主进程内完成，rows 不进入任何消息 ────────────────────
    let rows;
    let meta;
    if (datasetId !== undefined) {
        const { ref, rows: datasetRows } = await input.store.readPresentationRows({ session, dataset_id: datasetId, signal: exec.signal });
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
    return {
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
        description: `把已经取到的数据渲染成一张可交互图，产物落在 workspace 的 ${CHART_ARTIFACT_DIR}/<chart_id>/（chart.html 可离线打开、可 present）。` +
            '**只回一条小回执，不回任何原始数据行**：序列走旁路，不进入上下文。' +
            '来源二选一：dataset_id（已授权的 DatasetRef）或 path（workspace 相对路径的 JSON，支持顶层数组或含行数组的 envelope）。' +
            'spec 是自由对象，至少给出 kind（line / area / column / candlestick / bar；后两者要 ohlc 四字段与真实时间列）与字段选择（series 或 ohlc），' +
            `最多保留 ${MAX_CHART_POINTS} 个点（超出由宿主下采样并如实标注）。` +
            '字段语义、可用键与错误码见 skill capital-chart-protocol —— 首次画图前先加载它。' +
            '结果里有时间序列（行情 / 净值 / 营收等）时，除文字结论外应**主动出一张图**，不要等用户点名；' +
            '图表是呈现不是分析：需要数值结论（首末值、涨跌幅、分位数等）仍走 data_junior 的 profile / query，不要用图去推断数字。',
        parameters,
        output: { schema: receiptSchema, render },
        async execute(args, exec) {
            return renderChart(options, args, exec);
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(render_chart)');
}
