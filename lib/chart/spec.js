/**
 * 图表 spec 的归一化与校验。
 *
 * 设计要点（见 docs/design/chart-visualization.md §3.3）：
 *  - spec 用**自由对象**表达，协议细节写在 skill 里按需加载，常驻的只有工具 schema——
 *    这是"可视化不污染上下文"的关键：模型不需要在每轮都看一遍图表 DSL。
 *  - 但自由对象不等于放任：这里做一次严格归一化，错误必须**可自愈**（点名字段 + 给候选）。
 *  - 与 query_dataset 同源的宽容度：模型经常把对象/数组序列化成 JSON 字符串再传
 *    （实测教训见 src/data-collector/dataset-tools.ts 的注释），这里在**工具边界**
 *    做一次宽容解析，内部保持严格。
 */
import { ChartError } from './errors.js';
export const CHART_KINDS = ['line', 'area', 'column', 'candlestick', 'bar'];
/**
 * 需要 OHLC 四字段（而不是单值字段选择）的 kind。
 *
 * 依据是图表库的数据契约本身：`CandlestickData` 与 `BarData` 都继承 `OhlcData`，
 * 而 `LineData` / `HistogramData` 继承 `SingleValueData`。把单值序列塞进 BarSeries
 * 不会报错，只会画出一张**空图** —— 所以这个约束必须在 spec 层硬拦，
 * 不能指望"模型会写对"（这是实测出来的坑，不是推演）。
 */
export const OHLC_KINDS = ['candlestick', 'bar'];
export const CHART_SERIES_TYPES = ['line', 'area', 'column'];
export const MARKER_POSITIONS = ['aboveBar', 'belowBar', 'inBar'];
export const MAX_CHART_SERIES = 6;
export const MAX_CHART_MARKERS = 50;
export const MAX_FIELD_NAME = 128;
export const MAX_CHART_TITLE = 200;
/**
 * 容忍的说法 → canonical 名。
 *
 * `histogram` 是图表库的类名，但它画的是**着色柱**、不是统计分箱直方图；直接把它当
 * canonical 名会让模型以为"可以画分布"。canonical 用 `column`，同时接受旧说法以免硬失败。
 * 同理 `bar` 在中文语境里常被当成"柱状图"，而它其实是 OHLC 柱：单值柱状图会得到一条
 * 明确指向 `column` 的错误，而不是一张空图。
 */
const KIND_ALIASES = {
    histogram: 'column',
    candles: 'candlestick',
    candle: 'candlestick',
    ohlc: 'bar',
    candlestick_bar: 'bar',
};
const SERIES_TYPE_ALIASES = { histogram: 'column' };
/** 面向模型的 kind 说明（错误信息与工具描述共用一处，避免两处措辞漂移）。 */
export function describeKinds() {
    return `${CHART_KINDS.join(' / ')}（candlestick 与 bar 需要 ohlc 四字段与真实时间列；单值柱状图用 column，本库没有统计分箱直方图）`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** 宽容解析：真对象直接用；JSON 字符串解析成对象后使用；其余返回 undefined。 */
function coerceObject(value) {
    if (isRecord(value))
        return value;
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text.length === 0 || text[0] !== '{')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/** 宽容解析对象数组：真数组、JSON 数组字符串、单个对象（或其 JSON 字符串）都接受。 */
function coerceObjectList(value) {
    if (Array.isArray(value))
        return value;
    if (isRecord(value))
        return [value];
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text.length === 0)
        return undefined;
    if (text[0] === '[' || text[0] === '{') {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed))
                return parsed;
            if (isRecord(parsed))
                return [parsed];
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function readFieldName(value, where) {
    if (typeof value !== 'string')
        throw new ChartError('chart_spec_invalid', `${where} must be a string field name`);
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_FIELD_NAME) {
        throw new ChartError('chart_spec_invalid', `${where} must be a field name of 1-${MAX_FIELD_NAME} characters`);
    }
    return trimmed;
}
function readOptionalFieldName(value, where) {
    if (value === undefined || value === null || value === '')
        return undefined;
    return readFieldName(value, where);
}
/** 取第一个出现的别名键；用于容忍模型用 x / time / time_field 等等价说法。 */
function pickAlias(source, names) {
    for (const name of names)
        if (source[name] !== undefined)
            return source[name];
    return undefined;
}
function readKind(value) {
    if (typeof value !== 'string') {
        throw new ChartError('chart_spec_invalid', `spec.kind is required and must be one of: ${describeKinds()}`);
    }
    const raw = value.trim().toLowerCase();
    const kind = (KIND_ALIASES[raw] ?? raw);
    if (!CHART_KINDS.includes(kind)) {
        throw new ChartError('chart_spec_invalid', `spec.kind must be one of: ${describeKinds()} (got ${JSON.stringify(value)})`, { allowed: [...CHART_KINDS] });
    }
    return kind;
}
function readSeries(value) {
    const list = coerceObjectList(value);
    if (list === undefined || list.length === 0) {
        throw new ChartError('chart_spec_invalid', 'spec.series is required for this kind: an array of 1-6 entries, each a field name or { field, label?, type? }');
    }
    if (list.length > MAX_CHART_SERIES) {
        throw new ChartError('chart_spec_invalid', `spec.series accepts at most ${MAX_CHART_SERIES} entries (got ${list.length})`);
    }
    return list.map((entry, index) => {
        if (typeof entry === 'string')
            return { field: readFieldName(entry, `spec.series[${index}]`), label: entry.trim(), type: 'line' };
        if (!isRecord(entry))
            throw new ChartError('chart_spec_invalid', `spec.series[${index}] must be a field name or an object`);
        const field = readFieldName(entry.field ?? entry.column ?? entry.name, `spec.series[${index}].field`);
        const label = typeof entry.label === 'string' && entry.label.trim().length > 0 ? entry.label.trim() : field;
        let type = 'line';
        if (entry.type !== undefined) {
            const raw = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
            const resolved = (SERIES_TYPE_ALIASES[raw] ?? raw);
            if (!CHART_SERIES_TYPES.includes(resolved)) {
                throw new ChartError('chart_spec_invalid', `spec.series[${index}].type must be one of: ${CHART_SERIES_TYPES.join(', ')} — 序列是单值字段，OHLC 图形（candlestick / bar）要用 spec.ohlc`, { allowed: [...CHART_SERIES_TYPES] });
            }
            type = resolved;
        }
        return { field, label, type };
    });
}
function readOhlc(value) {
    const ohlc = coerceObject(value);
    if (!ohlc) {
        throw new ChartError('chart_spec_invalid', 'candlestick requires spec.ohlc = { open, high, low, close } with four field names');
    }
    return {
        open: readFieldName(ohlc.open, 'spec.ohlc.open'),
        high: readFieldName(ohlc.high, 'spec.ohlc.high'),
        low: readFieldName(ohlc.low, 'spec.ohlc.low'),
        close: readFieldName(ohlc.close, 'spec.ohlc.close'),
    };
}
function readVolume(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value === 'string')
        return { field: readFieldName(value, 'spec.volume') };
    const volume = coerceObject(value);
    if (!volume)
        throw new ChartError('chart_spec_invalid', 'spec.volume must be a field name or { field }');
    const field = readOptionalFieldName(volume.field ?? volume.column, 'spec.volume.field');
    if (field === undefined)
        throw new ChartError('chart_spec_invalid', 'spec.volume requires a field name');
    return { field };
}
function readMarkers(value) {
    if (value === undefined || value === null)
        return [];
    const list = coerceObjectList(value);
    if (list === undefined)
        throw new ChartError('chart_spec_invalid', 'spec.markers must be an array of { time|index, text, position? }');
    if (list.length > MAX_CHART_MARKERS) {
        throw new ChartError('chart_spec_invalid', `spec.markers accepts at most ${MAX_CHART_MARKERS} entries (got ${list.length})`);
    }
    return list.map((entry, index) => {
        if (!isRecord(entry))
            throw new ChartError('chart_spec_invalid', `spec.markers[${index}] must be an object`);
        const text = typeof (entry.text ?? entry.label) === 'string' ? String(entry.text ?? entry.label).trim() : '';
        if (text.length === 0 || text.length > 120) {
            throw new ChartError('chart_spec_invalid', `spec.markers[${index}].text must be 1-120 characters`);
        }
        const rawPosition = typeof entry.position === 'string' ? entry.position.trim() : 'aboveBar';
        if (!MARKER_POSITIONS.includes(rawPosition)) {
            throw new ChartError('chart_spec_invalid', `spec.markers[${index}].position must be one of: ${MARKER_POSITIONS.join(', ')}`, { allowed: [...MARKER_POSITIONS] });
        }
        const rawTime = pickAlias(entry, ['time', 'date', 'x']);
        const rawIndex = entry.index ?? entry.i;
        if (rawTime === undefined && rawIndex === undefined) {
            throw new ChartError('chart_spec_invalid', `spec.markers[${index}] needs a time (matching spec.x) or a 0-based index`);
        }
        const marker = { text, position: rawPosition };
        if (rawTime !== undefined) {
            if (typeof rawTime !== 'string' && typeof rawTime !== 'number') {
                throw new ChartError('chart_spec_invalid', `spec.markers[${index}].time must be a string or number`);
            }
            marker.time = rawTime;
        }
        if (rawIndex !== undefined) {
            if (typeof rawIndex !== 'number' || !Number.isSafeInteger(rawIndex) || rawIndex < 0) {
                throw new ChartError('chart_spec_invalid', `spec.markers[${index}].index must be a non-negative integer`);
            }
            marker.index = rawIndex;
        }
        return marker;
    });
}
function readRange(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const range = coerceObject(value);
    if (!range)
        throw new ChartError('chart_spec_invalid', 'spec.range must be an object { from?, to? }');
    const from = pickAlias(range, ['from', 'start']);
    const to = pickAlias(range, ['to', 'end']);
    const read = (raw, where) => {
        if (raw === undefined || raw === null || raw === '')
            return undefined;
        if (typeof raw === 'number' && Number.isFinite(raw))
            return raw;
        if (typeof raw === 'string')
            return raw.trim();
        throw new ChartError('chart_spec_invalid', `spec.range.${where} must be a date string or an epoch number`);
    };
    const result = { from: read(from, 'from'), to: read(to, 'to') };
    if (result.from === undefined && result.to === undefined)
        return undefined;
    return result;
}
export function normalizeChartSpec(raw) {
    const spec = coerceObject(raw);
    if (!spec) {
        throw new ChartError('chart_spec_invalid', 'spec must be an object (a JSON object string is also accepted); see skill capital-chart-protocol');
    }
    const kind = readKind(spec.kind);
    const timeField = readOptionalFieldName(pickAlias(spec, ['x', 'time_field', 'time']), 'spec.x');
    const volume = readVolume(pickAlias(spec, ['volume', 'volume_field']));
    const markers = readMarkers(spec.markers);
    const range = readRange(spec.range);
    const title = typeof spec.title === 'string' && spec.title.trim().length > 0 ? spec.title.trim().slice(0, MAX_CHART_TITLE) : undefined;
    if (OHLC_KINDS.includes(kind)) {
        const ohlc = readOhlc(spec.ohlc ?? spec.candles);
        if (timeField === undefined) {
            throw new ChartError('chart_spec_invalid', `${kind} requires spec.x: the time field name (OHLC 图形需要真实时间轴，不能退化成分类轴)`);
        }
        return { kind, axis: 'time', timeField, series: [], ohlc, volume, markers, range, title };
    }
    if (spec.ohlc !== undefined && spec.ohlc !== null && spec.ohlc !== '') {
        throw new ChartError('chart_spec_invalid', `spec.ohlc 只用于 candlestick / bar；kind=${kind} 请改用 spec.series（单值字段选择）`);
    }
    const series = readSeries(spec.series ?? spec.fields ?? spec.y);
    return { kind, axis: timeField === undefined ? 'index' : 'time', timeField, series, volume, markers, range, title };
}
