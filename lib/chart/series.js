/**
 * 把原始 rows 变成**有界、对齐、可渲染**的图表载荷。
 *
 * 边界（这是整个方案的核心不变量）：本模块的**输入**是原始 rows，**输出**是可视化载荷。
 * 输出会写进 workspace 产物并交给浏览器，永不进入模型上下文；工具只回一条小回执。
 * 因此这里可以放心读全量行，但必须保证输出有界（点数上限 + 字段数上限 + 标记数上限）。
 */
import { largestTriangleThreeBuckets } from './downsample.js';
import { ChartError } from './errors.js';
import { MAX_CHART_MARKERS, MAX_CHART_SERIES, OHLC_KINDS } from './spec.js';
/** 单张图保留的最大点数（下采样后）。轻量图表在这个量级仍然流畅，且载荷只有几十 KB。 */
export const MAX_CHART_POINTS = 2_000;
/** 字段候选清单最多回报多少个（错误路径本身也不能变成上下文炸弹）。 */
export const MAX_FIELD_HINTS = 15;
/** 判定"x 是时间列"的采样解析成功率阈值。 */
const TIME_AXIS_THRESHOLD = 0.8;
/** 分类轴的合成时间基准（UTC 秒）：1970 太容易被误认为真实时间，取 2000-01-01。 */
const INDEX_EPOCH_SECONDS = Date.UTC(2000, 0, 1) / 1000;
const SECONDS_PER_DAY = 86_400;
/** epoch 毫秒与秒的分界：>= 1e11 视为毫秒（1e11 秒 ≈ 公元 5138 年）。 */
const MILLISECONDS_THRESHOLD = 1e11;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/**
 * 从解析好的 JSON 里取出行数组。
 *
 * 真实数据源的同花顺返回常常是 envelope（行数组在 `item` / `data` / `stock_items` …），
 * 所以这里不能只认顶层数组；但也不能乱猜——猜错会让用户看到一张空图或错图。
 * 策略：顶层数组直接用；否则在候选键里找；候选都没有时列出**全部**数组型顶层键让模型
 * 自己指定路径，而不是静默取第一个。
 */
export function extractRows(value) {
    if (Array.isArray(value))
        return { rows: value, shape: 'array' };
    if (!isRecord(value)) {
        throw new ChartError('chart_no_rows', 'the JSON source must be an array of rows or an object containing one');
    }
    const preferred = ['item', 'items', 'data', 'rows', 'list', 'records', 'result'];
    for (const key of preferred) {
        const candidate = value[key];
        if (Array.isArray(candidate) && candidate.length > 0)
            return { rows: candidate, shape: key };
    }
    const arrayKeys = Object.keys(value).filter((key) => Array.isArray(value[key]) && value[key].length > 0);
    if (arrayKeys.length === 1)
        return { rows: value[arrayKeys[0]], shape: arrayKeys[0] };
    if (arrayKeys.length > 1) {
        throw new ChartError('chart_source_invalid', 'the JSON object has several candidate row arrays; wrap the wanted one in an array or extract it first', { array_keys: arrayKeys.slice(0, MAX_FIELD_HINTS) });
    }
    throw new ChartError('chart_no_rows', 'the JSON object contains no row array', { object_keys: Object.keys(value).slice(0, MAX_FIELD_HINTS) });
}
/** 字段候选清单：按出现顺序去重，最多 MAX_FIELD_HINTS 个。 */
function collectFields(records) {
    const seen = [];
    const set = new Set();
    for (const record of records) {
        for (const key of Object.keys(record)) {
            if (set.has(key))
                continue;
            set.add(key);
            seen.push(key);
            if (seen.length >= 200)
                return seen;
        }
    }
    return seen;
}
function assertFields(fields, available) {
    const missing = [...new Set(fields.filter((field) => field !== undefined))].filter((field) => !available.includes(field));
    if (missing.length === 0)
        return;
    // 候选清单写进 message：模型看到的错误文本就是自愈所需的全部信息，
    // 不依赖调用方是否把 details 透传出去。
    const hints = available.slice(0, MAX_FIELD_HINTS);
    const suffix = hints.length > 0 ? `; available fields: ${hints.join(', ')}${available.length > hints.length ? ` (共 ${available.length} 个，其余已省略)` : ''}` : '';
    throw new ChartError('chart_field_not_found', `field not found in the data: ${missing.join(', ')}${suffix}`, {
        missing,
        available: hints,
        available_total: available.length,
    });
}
/** 数值读取：数字直接用，纯数字字符串兼容（与 Dataset schema 的 allow_numeric_string 同源）。 */
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
        const text = value.trim();
        if (text.length === 0 || text.length > 32)
            return undefined;
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
            return undefined;
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
/**
 * 时间值解析。规则必须**确定**（同一份数据在任何机器上得到同一张图）：
 *  - 纯日期 `YYYY-MM-DD` → 业务日字符串，交给图表库按业务日显示（不做时区换算，避免差一天）；
 *  - `YYYY-MM-DD HH:mm[:ss]` 无时区 → 按 UTC 解释（显式规则，不依赖宿主本地时区）；
 *  - 数字/纯数字字符串 → epoch；`>= 1e11` 视为毫秒，否则视为秒；
 *  - 其余字符串 → `Date.parse`；失败即视为该行没有时间。
 */
export function parseTimeValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return undefined;
        const seconds = Math.abs(value) >= MILLISECONDS_THRESHOLD ? Math.round(value / 1000) : Math.round(value);
        return { display: seconds, seconds, dateOnly: false };
    }
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text.length === 0 || text.length > 40)
        return undefined;
    const dateOnly = DATE_ONLY.exec(text);
    if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        const check = new Date(Date.UTC(year, month - 1, day));
        if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day)
            return undefined;
        return { display: text, seconds: Math.round(check.getTime() / 1000), dateOnly: true };
    }
    const dateTime = DATE_TIME.exec(text);
    if (dateTime) {
        const normalized = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6] ?? '00'}${dateTime[7] ?? 'Z'}`;
        const parsed = Date.parse(normalized);
        if (!Number.isFinite(parsed))
            return undefined;
        return { display: Math.round(parsed / 1000), seconds: Math.round(parsed / 1000), dateOnly: false };
    }
    if (/^\d+$/.test(text))
        return parseTimeValue(Number(text));
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed))
        return undefined;
    return { display: Math.round(parsed / 1000), seconds: Math.round(parsed / 1000), dateOnly: false };
}
export function buildChartPayload(input) {
    const { spec } = input;
    const warnings = [];
    const records = input.rows.filter(isRecord);
    if (records.length === 0) {
        throw new ChartError('chart_no_rows', 'the source contains no object rows to chart');
    }
    const available = collectFields(records);
    if (spec.axis === 'time' && spec.timeField !== undefined)
        assertFields([spec.timeField], available);
    for (const series of spec.series)
        assertFields([series.field], available);
    if (spec.ohlc)
        assertFields([spec.ohlc.open, spec.ohlc.high, spec.ohlc.low, spec.ohlc.close], available);
    if (spec.volume)
        assertFields([spec.volume.field], available);
    // ── 1. 时间轴判定 ─────────────────────────────────────────────────────────
    // 显式给了 x 但值不像时间（分类数据）时，自动降级为分类轴并用 x 的取值做刻度标签，
    // 而不是报错让模型改口——"用 x 画柱状图"是最自然的表达。
    const axisField = spec.timeField;
    let axis = axisField === undefined ? 'index' : 'time';
    // OHLC 图形（candlestick / bar）不允许降级：图表库的 OhlcData 需要真实有序时间轴，
    // 拿分类轴硬画只会得到一张错位的图。
    if (axisField !== undefined && !OHLC_KINDS.includes(spec.kind)) {
        const sample = records.slice(0, 100);
        const parsed = sample.filter((record) => parseTimeValue(record[axisField]) !== undefined).length;
        if (parsed / sample.length < TIME_AXIS_THRESHOLD)
            axis = 'index';
    }
    // ── 2. 逐行预处理 ────────────────────────────────────────────────────────
    const prepared = [];
    let skippedRows = 0;
    records.forEach((record, sourceIndex) => {
        if (axis === 'time' && axisField !== undefined) {
            const time = parseTimeValue(record[axisField]);
            if (time === undefined) {
                skippedRows += 1;
                return;
            }
            prepared.push({ time, raw: record, indexLabel: String(sourceIndex + 1), sourceIndex });
            return;
        }
        const label = axisField === undefined ? String(sourceIndex + 1) : String(record[axisField] ?? sourceIndex + 1);
        prepared.push({
            time: { display: INDEX_EPOCH_SECONDS + prepared.length * SECONDS_PER_DAY, seconds: INDEX_EPOCH_SECONDS + prepared.length * SECONDS_PER_DAY, dateOnly: false },
            raw: record,
            indexLabel: label,
            sourceIndex,
        });
    });
    if (skippedRows > 0)
        warnings.push(`${skippedRows} row(s) skipped: the time field is missing or unparseable`);
    if (prepared.length === 0) {
        // OHLC 图形必须给可解析的时间列：它不是"降级"问题，而是这张图根本画不出来。
        // 错误必须直接把模型引到能用的 kind 上，而不是让它反复试同一个 spec。
        if (OHLC_KINDS.includes(spec.kind)) {
            throw new ChartError('chart_no_rows', `${spec.kind} 需要可解析的时间列，但字段 "${axisField ?? '(未提供 x)'}" 的值都解析不出日期或时间戳；分类数据请改用 kind=column（单值柱）或 line`);
        }
        throw new ChartError('chart_no_rows', 'no row has a usable time value');
    }
    // ── 3. 排序 + 去重 + 区间过滤 ──────────────────────────────────────────────
    const ordered = [...prepared].sort((left, right) => left.time.seconds - right.time.seconds);
    if (ordered.some((row, index) => row !== prepared[index]))
        warnings.push('rows were reordered ascending by time (the chart library requires an ordered axis)');
    const unique = [];
    for (const row of ordered) {
        if (unique.length > 0 && unique[unique.length - 1].time.seconds === row.time.seconds) {
            unique[unique.length - 1] = row;
            continue;
        }
        unique.push(row);
    }
    if (unique.length !== ordered.length)
        warnings.push(`${ordered.length - unique.length} duplicate timestamp(s) collapsed`);
    let filtered = unique;
    if (spec.range) {
        const from = spec.range.from === undefined ? undefined : parseTimeValue(spec.range.from)?.seconds;
        const to = spec.range.to === undefined ? undefined : parseTimeValue(spec.range.to)?.seconds;
        if (spec.range.from !== undefined && from === undefined)
            throw new ChartError('chart_spec_invalid', 'spec.range.from is not a recognizable date');
        if (spec.range.to !== undefined && to === undefined)
            throw new ChartError('chart_spec_invalid', 'spec.range.to is not a recognizable date');
        filtered = unique.filter((row) => (from === undefined || row.time.seconds >= from) && (to === undefined || row.time.seconds <= to));
        if (filtered.length === 0)
            throw new ChartError('chart_no_rows', 'spec.range excludes every row');
    }
    // ── 4. 下采样（一次求下标，所有子序列共用）────────────────────────────────
    const originalPoints = filtered.length;
    const primaryValues = primarySeriesValues(filtered, spec);
    const keep = originalPoints > MAX_CHART_POINTS ? largestTriangleThreeBuckets(primaryValues, MAX_CHART_POINTS) : filtered.map((_row, index) => index);
    const kept = keep.map((index) => filtered[index]).filter((row) => row !== undefined);
    const downsampled = kept.length < originalPoints;
    // ── 5. 时间显示口径：全是纯日期才用业务日字符串 ────────────────────────────
    const useBusinessDay = axis === 'time' && kept.every((row) => row.time.dateOnly);
    if (axis === 'time' && !useBusinessDay && kept.some((row) => row.time.dateOnly)) {
        warnings.push('mixed date and datetime values; the axis is rendered as timestamps');
    }
    const displayTime = (row) => (useBusinessDay ? String(row.time.display) : row.time.seconds);
    // ── 6. 子序列 ────────────────────────────────────────────────────────────
    const series = [];
    for (const item of spec.series.slice(0, MAX_CHART_SERIES)) {
        const data = [];
        let dropped = 0;
        for (const row of kept) {
            const value = toNumber(row.raw[item.field]);
            if (value === undefined) {
                dropped += 1;
                continue;
            }
            data.push({ time: displayTime(row), value });
        }
        if (data.length === 0)
            throw new ChartError('chart_field_not_found', `field "${item.field}" has no numeric value in the selected range`, { field: item.field });
        if (dropped > 0)
            warnings.push(`series "${item.label}": ${dropped} point(s) dropped (non-numeric or missing)`);
        series.push({ id: item.field, label: item.label, type: item.type, data });
    }
    let ohlc;
    if (spec.ohlc) {
        const data = [];
        let dropped = 0;
        // OHLC 自洽性检查：脏数据确实存在，所以**不拦截**（拦截会让用户看不到任何图），
        // 但必须如实披露，否则读者会把一根 high<low 的错柱子当成真行情。
        let inconsistent = 0;
        const inconsistentExamples = [];
        for (const row of kept) {
            const open = toNumber(row.raw[spec.ohlc.open]);
            const high = toNumber(row.raw[spec.ohlc.high]);
            const low = toNumber(row.raw[spec.ohlc.low]);
            const close = toNumber(row.raw[spec.ohlc.close]);
            if (open === undefined || high === undefined || low === undefined || close === undefined) {
                dropped += 1;
                continue;
            }
            if (high < low || open > high || open < low || close > high || close < low) {
                inconsistent += 1;
                if (inconsistentExamples.length < 3)
                    inconsistentExamples.push(String(row.time.display));
            }
            data.push({ time: displayTime(row), open, high, low, close });
        }
        if (data.length === 0)
            throw new ChartError('chart_field_not_found', 'the OHLC fields have no numeric values in the selected range');
        if (dropped > 0)
            warnings.push(`OHLC: ${dropped} 行因字段缺失被丢弃`);
        if (inconsistent > 0) {
            warnings.push(`${inconsistent} 根 K 线的 OHLC 不自洽（high < low 或开/收越界），可能是数据问题；图上按原始值呈现，例如 ${inconsistentExamples.join('、')}`);
        }
        ohlc = { label: spec.title ?? 'OHLC', data };
    }
    let volume;
    const volumeSpec = spec.volume;
    if (volumeSpec) {
        const data = [];
        let dropped = 0;
        for (const row of kept) {
            const value = toNumber(row.raw[volumeSpec.field]);
            if (value === undefined) {
                dropped += 1;
                continue;
            }
            // A 股习惯：涨红跌绿。方向由同一行的 OHLC 推得，颜色映射留给运行时（跟随主题）。
            let direction;
            if (spec.ohlc) {
                const open = toNumber(row.raw[spec.ohlc.open]);
                const close = toNumber(row.raw[spec.ohlc.close]);
                if (open !== undefined && close !== undefined)
                    direction = close >= open ? 'up' : 'down';
            }
            data.push({ time: displayTime(row), value, ...(direction === undefined ? {} : { direction }) });
        }
        if (data.length === 0)
            throw new ChartError('chart_field_not_found', `field "${volumeSpec.field}" has no numeric value in the selected range`, { field: volumeSpec.field });
        if (dropped > 0)
            warnings.push(`volume: ${dropped} point(s) dropped (non-numeric or missing)`);
        volume = { label: '成交量', data };
    }
    // ── 7. 标记点：吸附到保留下来的时间点 ──────────────────────────────────────
    const markers = [];
    const keptSeconds = kept.map((row) => row.time.seconds);
    for (const marker of spec.markers.slice(0, MAX_CHART_MARKERS)) {
        // 两种定位都先化成"目标秒数"，再吸附到**保留**的时间点上：下采样把某个点丢掉时，
        // 标记不该跟着消失（那正是用户最在意的那一天）。
        let targetSeconds;
        if (marker.index !== undefined) {
            const atIndex = filtered[marker.index];
            if (atIndex === undefined) {
                warnings.push(`marker "${marker.text}" dropped: index ${marker.index} is outside the charted range (0-${filtered.length - 1})`);
                continue;
            }
            targetSeconds = atIndex.time.seconds;
        }
        else if (marker.time !== undefined) {
            targetSeconds = parseTimeValue(marker.time)?.seconds;
        }
        const target = targetSeconds === undefined ? undefined : nearestRow(kept, keptSeconds, targetSeconds);
        if (target === undefined) {
            warnings.push(`marker "${marker.text}" dropped: its time/index is outside the charted range`);
            continue;
        }
        markers.push({ time: displayTime(target), text: marker.text, position: marker.position });
    }
    const labels = {};
    if (axis === 'index')
        for (const row of kept)
            labels[String(row.time.seconds)] = row.indexLabel;
    return {
        chart_id: input.chart_id,
        title: spec.title ?? '数据图表',
        kind: spec.kind,
        axis,
        series,
        ...(ohlc === undefined ? {} : { ohlc }),
        ...(volume === undefined ? {} : { volume }),
        markers,
        ...(axis === 'index' ? { labels } : {}),
        meta: {
            points: kept.length,
            original_points: originalPoints,
            downsampled,
            ...(spec.timeField === undefined ? {} : { time_field: spec.timeField }),
            axis,
            source_kind: input.meta.source_kind,
            ...(input.meta.dataset_id === undefined ? {} : { dataset_id: input.meta.dataset_id }),
            ...(input.meta.source_label === undefined ? {} : { source_label: input.meta.source_label }),
            ...(input.meta.captured_at === undefined ? {} : { captured_at: input.meta.captured_at }),
            skipped_rows: skippedRows,
            warnings,
        },
    };
}
/** 主序列取值（用于 LTTB）；K 线用收盘价，其余用第一个数值字段。 */
function primarySeriesValues(rows, spec) {
    const field = spec.ohlc ? spec.ohlc.close : spec.series[0]?.field ?? spec.volume?.field;
    const values = [];
    let last = 0;
    for (const row of rows) {
        const value = field === undefined ? undefined : toNumber(row.raw[field]);
        last = value ?? last;
        values.push(last);
    }
    return values;
}
/** 把标记点吸附到最近的**保留**时间点，避免下采样后标记消失。 */
function nearestRow(rows, keptSeconds, target) {
    if (rows.length === 0)
        return undefined;
    let low = 0;
    let high = keptSeconds.length - 1;
    let best = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (keptSeconds[middle] <= target) {
            best = middle;
            low = middle + 1;
        }
        else {
            high = middle - 1;
        }
    }
    const candidates = [best, best + 1].filter((index) => index >= 0 && index < keptSeconds.length);
    if (candidates.length === 0)
        return undefined;
    let chosen = candidates[0];
    for (const index of candidates) {
        if (Math.abs(keptSeconds[index] - target) < Math.abs(keptSeconds[chosen] - target))
            chosen = index;
    }
    return rows[chosen];
}
