const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
function render(_args, value) {
    // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
    return [{ type: 'text', text: JSON.stringify(value) }];
}
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
/** 校验并规范化 IANA 时区名；undefined 表示宿主本地时区。'UTC'/'GMT' 为合法特殊值。 */
export function resolveTimeZone(timeZone) {
    if (timeZone === undefined)
        return undefined;
    if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
        throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")');
    }
    if (timeZone !== 'UTC' && timeZone !== 'GMT' && !IANA_TIME_ZONE.test(timeZone)) {
        throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")');
    }
    let resolved;
    try {
        resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    }
    catch {
        throw new Error(`unsupported IANA timezone: ${JSON.stringify(timeZone)}`);
    }
    return resolved;
}
/** 宿主进程的本地 IANA 时区名。 */
export function localTimeZone() {
    return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone;
}
function two(value) {
    return String(value).padStart(2, '0');
}
/**
 * 把 Intl 的 timeZoneName（"GMT+08:00" / "GMT-05:00" / "GMT"）规范化为
 * "+08:00" / "-05:00" / "+00:00"。解析失败返回 null，调用方回退到差值算法。
 */
function normalizeUtcOffset(timeZoneName) {
    if (timeZoneName === 'GMT' || timeZoneName === 'UTC')
        return '+00:00';
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(timeZoneName);
    if (!match)
        return null;
    return `${match[1]}${two(Number(match[2]))}:${match[3] ?? '00'}`;
}
/**
 * 差值法计算某 IANA 时区在 now 时刻的 UTC 偏移毫秒数（timeZoneName 缺失时的回退）。
 */
function zoneOffsetMsByDiff(now, zone) {
    const fields = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    };
    const read = (parts) => {
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    };
    const utcParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' }).formatToParts(now);
    const zoneParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: zone }).formatToParts(now);
    return read(zoneParts) - read(utcParts);
}
/** 当前时刻读数（内部纯函数，便于测试）：now 为 epoch 毫秒。 */
export function readClock(now, timeZone) {
    const zone = resolveTimeZone(timeZone) ?? localTimeZone();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23', weekday: 'long', timeZoneName: 'longOffset',
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    let utcOffset = parts.timeZoneName ? normalizeUtcOffset(parts.timeZoneName) : null;
    if (utcOffset === null) {
        const offsetMs = zoneOffsetMsByDiff(now, zone);
        const sign = offsetMs < 0 ? '-' : '+';
        const abs = Math.abs(offsetMs);
        utcOffset = `${sign}${two(Math.floor(abs / 3_600_000))}:${two(Math.floor((abs % 3_600_000) / 60_000))}`;
    }
    const offsetMinutes = (utcOffset.startsWith('-') ? -1 : 1) * (Number(utcOffset.slice(1, 3)) * 60 + Number(utcOffset.slice(4, 6)));
    return {
        iso_local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${utcOffset}`,
        iso_utc: new Date(now).toISOString(),
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}:${parts.second}`,
        weekday: parts.weekday,
        timezone: zone,
        utc_offset: utcOffset,
        utc_offset_minutes: offsetMinutes,
        epoch_ms: now,
    };
}
/**
 * 注册时间工具（会话组作用域：主 Agent 与所有子 Agent 均可见，与数据工具同一
 * 注册通道）。模型知识截止日期不是当前时间；涉及"今天/现在/此刻/周几"的判断
 * 必须先调用本工具，绝不凭记忆猜测。
 */
export function registerTimeTool(ctx) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const definition = {
        name: 'get_local_datetime',
        description: '获取当前真实日期时间的权威读数：宿主机器时钟 + IANA 时区（本地时区名与 UTC 偏移）。' +
            '模型知识截止日期绝不是当前时间；凡涉及"今天/现在/最新/此刻/周几/多少天前"的判断或时间戳换算，' +
            '必须先调用本工具取得当前时刻，再基于它计算，绝不凭记忆猜测。可选 timezone 参数可指定 IANA 时区显示。',
        parameters: jsonObject({ timezone: { type: 'string', description: '可选 IANA 时区名（如 "Asia/Shanghai"）；缺省为宿主本地时区' } }),
        output: {
            schema: jsonObject({
                iso_local: { type: 'string' },
                iso_utc: { type: 'string' },
                date: { type: 'string' },
                time: { type: 'string' },
                weekday: { type: 'string' },
                timezone: { type: 'string' },
                utc_offset: { type: 'string' },
                utc_offset_minutes: { type: 'integer' },
                epoch_ms: { type: 'integer' },
            }, ['iso_local', 'iso_utc', 'date', 'time', 'weekday', 'timezone', 'utc_offset', 'utc_offset_minutes', 'epoch_ms']),
            render,
        },
        async execute(args, _exec) {
            return readClock(Date.now(), resolveTimeZone(args.timezone));
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(get_local_datetime)');
}
