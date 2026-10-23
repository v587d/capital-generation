import { MAX_CHARTS_PER_TURN } from './events.js';
import { callerSession } from '../tool-exec.js';
/** One card can carry many files (the client collapses past four); the cap only bounds one event. */
export const MAX_PRESENT_CHARTS = 32;
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const parameters = jsonObject({
    chart_refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'data_junior 回传的全部 chart_ref，一次传完（最多 8 个，不猜写）。与 task_id 至少给一个。',
    },
    task_id: {
        type: 'string',
        description: '本任务 canonical task_id：省略 chart_refs 时按它登记本会话该任务的全部图表（上下文压缩后记不清 refs 时用）。',
    },
});
const receiptSchema = jsonObject({
    presented: {
        type: 'array',
        items: jsonObject({
            chart_ref: { type: 'string' },
            title: { type: 'string' },
        }, ['chart_ref', 'title']),
    },
    failed: {
        type: 'array',
        items: jsonObject({
            chart_ref: { type: 'string' },
            reason: { type: 'string' },
        }, ['chart_ref', 'reason']),
    },
}, ['presented', 'failed']);
function normalizeRefs(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error('present_charts 的 chart_refs 必须是字符串数组');
    const refs = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.trim().length === 0)
            throw new Error('present_charts 的 chart_refs 里不能有空值');
        const ref = item.trim();
        if (!refs.includes(ref))
            refs.push(ref);
    }
    if (refs.length > MAX_PRESENT_CHARTS) {
        throw new Error(`present_charts 一次最多登记 ${MAX_PRESENT_CHARTS} 张图（收到 ${refs.length} 个 chart_ref）`);
    }
    return refs;
}
function normalizeTaskId(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error('present_charts 的 task_id 必须是非空字符串');
    return value.trim();
}
/** Present refs first; otherwise present the whole task so compaction cannot strand the charts. */
function selectArtifacts(input, session, refs, taskId) {
    const failed = [];
    if (refs.length > 0) {
        const selected = [];
        for (const chartRef of refs) {
            try {
                selected.push(input.artifacts.resolve({ session, chart_ref: chartRef, task_id: taskId }));
            }
            catch (error) {
                failed.push({ chart_ref: chartRef, reason: error instanceof Error ? error.message : String(error) });
            }
        }
        // A stale ref set must not strand charts the task_id can still find (compaction can mix both).
        if (selected.length > 0 || taskId === undefined)
            return { selected, failed };
    }
    if (taskId === undefined)
        throw new Error('present_charts 需要 chart_refs 或 task_id：两者都不给就无法确定要登记哪几张图');
    const all = input.artifacts.list({ session, task_id: taskId });
    if (all.length === 0)
        failed.push({ chart_ref: '(task)', reason: `本会话该 task_id 没有可登记的图表：${taskId}` });
    const selected = all.slice(0, MAX_PRESENT_CHARTS);
    if (all.length > MAX_PRESENT_CHARTS) {
        failed.push({ chart_ref: '(task)', reason: `该 task_id 有 ${all.length} 张图，单次最多登记 ${MAX_PRESENT_CHARTS} 张；其余未展示` });
    }
    return { selected, failed };
}
export function registerPresentChartsTool(ctx, input) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const definition = {
        name: 'present_charts',
        description: '把本会话已生成的图表登记为**最终答复的交付物**（官方 deliverables/presented）：用户会在答复末尾的「本轮文件改动 / 交付」行看到卡片，点开即渲染自包含 chart.html。'
            + '**由主 Agent 调用一次**：参数是 data_junior 回传的 chart_refs（一次传入，最多 32 个）；refs 已丢失时改传 task_id 登记该任务的全部图表。'
            + '这里只记录本轮要交付的图，宿主会在**最终答复之前**统一写入交付行——提前调用不会落进中间轮，不必等“最后一刻”，也不要在过程轮反复调用。'
            + '不要传文件路径或 HTML（路径由宿主解析）；不调用时宿主仍会在收尾时自动登记本 exchange 已生成的图表。',
        parameters,
        async execute(args, exec) {
            const session = callerSession(exec);
            const refs = normalizeRefs(args.chart_refs);
            const taskId = normalizeTaskId(args.task_id);
            if (refs.length === 0 && taskId === undefined) {
                throw new Error('present_charts 需要 chart_refs 或 task_id：两者都不给就无法确定要登记哪几张图');
            }
            const { selected, failed } = selectArtifacts(input, session, refs, taskId);
            const receipt = { presented: [], failed };
            if (selected.length === 0)
                return receipt;
            const inputs = selected.map((artifact) => ({
                ownerSessionId: session.id,
                chart_id: artifact.chart_id,
                title: artifact.title,
                html_path: artifact.html_path,
            }));
            // Normal path: remember the selection; the closing stream chunk writes it before the answer.
            if (input.delivery?.streaming() === true) {
                input.delivery.request(session, inputs);
                for (const artifact of selected)
                    receipt.presented.push({ chart_ref: artifact.chart_ref, title: artifact.title });
                return receipt;
            }
            // Fallback path (stream listener unavailable): write now, but only when the turn is idle.
            const blocked = await input.readiness?.(session);
            if (blocked !== undefined)
                throw new Error(blocked);
            const publisher = input.chartEvents();
            if (publisher === undefined) {
                throw new Error('图表交付通道不可用（sessions / sessionProjections 解析不到）：图表已落盘，可在 workspace 打开 chart.html');
            }
            const accepted = publisher.publishMany !== undefined
                ? publisher.publishMany(session.id, inputs)
                : inputs.every((item) => publisher.publish(item));
            if (accepted) {
                for (const artifact of selected)
                    receipt.presented.push({ chart_ref: artifact.chart_ref, title: artifact.title });
            }
            else {
                for (const artifact of selected) {
                    receipt.failed.push({ chart_ref: artifact.chart_ref, reason: `本轮登记已达 ${MAX_CHARTS_PER_TURN} 次上限或回合已关闭，未写入交付行` });
                }
            }
            return receipt;
        },
        output: {
            schema: receiptSchema,
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
    };
    ctx.effect(() => tools.register(definition), 'capital-generation.tool(present_charts)');
}
