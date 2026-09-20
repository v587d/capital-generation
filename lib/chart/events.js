/**
 * 图表 → 对话流的宿主侧事件通道（**first-party 口径**）。
 *
 * 问题：图表由 `visualization_specialist`（主 Agent 的**孙** Agent）生成，它的 tool call
 * 落在自己的会话里；用户在客户端看的是主会话，子会话的事件不会流过来。
 *
 * 做法：`render_chart` 成功后，宿主往**用户正在看的那条会话**追加官方
 * `deliverables/presented` 事件（`present` 工具用的同一条通道），把
 * `capital-analysis/charts/<chart_id>/chart.html` 登记为本轮交付物。用户在收尾的
 * 「本轮文件改动 / 交付」行点开该文件，右侧即用官方 document preview 的
 * script-enabled iframe 渲染自包含图表。
 *
 * ⚠️ 为什么**绝不能**再发明自己的事件类型（2026-09-18 事故，实测根因）：
 * 会话日志的事件词汇表是**闭集**——`@deepseek-ai/dsh-session` 的
 * `KNOWN_SESSION_EVENT_TYPES` 由 harness 仓库自己的 `SessionEventMap` 生成，
 * 注释明写 "downstream (out-of-repo) plugin events are outside this list by
 * construction"。读取侧 `validateStoredEvents()` 是 fail-closed 的：
 *
 *   `KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true`
 *
 * 否则抛 `SessionFormatUnsupportedError` 并拒绝解释**整份日志**。而 `Session.append`
 * 的 options 只转发 `sourceEventSeqs` / `surfaceOp`——**调用方无法设置 `ignorable`**
 * （实测 0.1.5-rc.2 与 0.1.6-alpha.2 都没有该选项）。于是自定义事件是"写时静默通过、
 * 冷加载时整份会话打不开"：本仓曾发 `capital/chart-rendered`，导致 6 份会话在重启后
 * 全部 `failed to observe session`。只有 first-party 事件能持久化。
 *
 * ⚠️ 回合归属（实测教训 2026-09-17）：交付行是**按回合**渲染的，只会出现在它所属回合的
 * 收尾位置。而主 Agent 在等子 Agent 时会**先结束自己的回合**，于是出图往往发生在两个回合
 * 之间——此时 `turnBoundary.lastTurn` 指向那个**已经结束**的回合，照抄它会把交付登记到
 * 上一轮。因此：
 *  - 有回合打开（`openTurnStartSeq` 是数字）→ 立即写入该回合；
 *  - 没有回合打开 → 先寄存，等 owner 的**下一个 `turn/start`** 再写入（那正是会消费这份
 *    子 Agent 结果、写下最终答复的回合）。
 * 寄存的冲刷必须延到微任务：`session/event` 观察者在 `Session.append` 的 appending 窗口内同步执行，
 * 在那里再次 append 会被 "session append cannot reenter" 拒绝。
 *
 * 为什么这不"污染 transcripts"：
 *  - `deliverables/presented` 不在 surface 事件表里，`deriveEventMessage()` 返回 null，
 *    因此它**永不进入** `deriveMessages()`（模型看到的消息历史）；
 *  - payload 只有 `turn` / `callId`（`capital-chart:<chart_id>` 句柄）/ `files[]`
 *    （工作区相对 `html_path` + 标题），没有 rows、series、HTML、绝对路径。
 *
 * 容错：`sessions` / `sessionProjections` 任一不可用、或 append 抛错，都只告警并跳过——
 * 出图本身绝不因此失败（文件已落盘、回执照样给 html_path）。
 */
import { chartSessionScopeId } from './artifact-ref.js';
/**
 * 登记本轮交付物用的官方事件名。
 *
 * 必须留在 `KNOWN_SESSION_EVENT_TYPES` 内——它是 `dsh-tool-present` 追加的同一类型，
 * 因此在**任何** harness 版本上都能被读回。改这里等于改会话日志契约，
 * `test/chart-turn-events.test.mjs` 有一条断言把它钉在 first-party 词汇表上。
 */
export const CHART_DELIVERABLE_EVENT = 'deliverables/presented';
/** `callId` 前缀：交付事件里携带的图表句柄（官方契约只要求非空字符串）。 */
export const CHART_CALL_ID_PREFIX = 'capital-chart:';
/** 同一 (session, turn) 的事件上限：防模型循环，超出只告警。 */
export const MAX_CHARTS_PER_TURN = 8;
/** 向上找根会话的最大跳数（main → data_junior → specialist 只有一跳，留余量）。 */
export const MAX_OWNER_HOPS = 4;
/**
 * 最近一次 publish 的逐步轨迹（模块级：发布器每次出图都新建，轨迹要跨实例可读）。
 */
let lastPublishTrace = '';
/** 只读：最近一次 publish 轨迹。 */
export function chartEventPublishTrace() {
    return lastPublishTrace;
}
function isAppendableSession(value) {
    return Boolean(value)
        && typeof value.append === 'function'
        && typeof value.id === 'string';
}
function parentSessionOf(session) {
    const parent = session.header?.parentSession;
    return typeof parent === 'string' && parent.length > 0 ? parent : undefined;
}
/**
 * 从 owner scope 出发向上走到根会话：用户看的是根会话的对话流，卡片必须挂在它上面。
 * 找不到（会话已回收）时返回 undefined，调用方静默跳过。
 */
export function resolveOwnerSession(sessions, ownerSessionId, maxHops = MAX_OWNER_HOPS) {
    let current;
    try {
        const first = sessions.get(ownerSessionId);
        current = isAppendableSession(first) ? first : undefined;
    }
    catch {
        return undefined;
    }
    if (current === undefined)
        return undefined;
    for (let hop = 0; hop < maxHops; hop += 1) {
        const parentId = parentSessionOf(current);
        if (parentId === undefined)
            break;
        let parent;
        try {
            parent = sessions.get(parentId);
        }
        catch {
            break;
        }
        if (!isAppendableSession(parent))
            break;
        current = parent;
    }
    return current;
}
/**
 * 官方 `deliverables/presented` 载荷。
 *
 * 形状与 `dsh-tool-present` 逐字段对齐（那边是 `{ turn, callId, files }`，
 * 客户端 `isPresentedData()` 要求 `turn` 是 >=1 的安全整数、`callId` 非空字符串、
 * `files` 是数组）。`files[].path` 必须是**工作区相对**路径：官方打开动作会拿它去
 * `workspaceFiles.stat({ sessionId, workspaceRoot: session.cwd })` 解析，绝对路径过不了
 * 「Presented file has no verified Host path」这一关。
 *
 * `callId` 只是官方契约里的一个非空字符串句柄，没有配对约束（`present` 那边用来关联
 * tool/result），这里借它携带 `chart_id`，便于在日志里把一条交付回溯到具体图表。
 */
export function buildChartEventPayload(input, turn) {
    return {
        turn,
        callId: `${CHART_CALL_ID_PREFIX}${input.chart_id}`,
        files: [
            {
                path: input.html_path,
                description: input.title,
            },
        ],
    };
}
/**
 * 待登记队列（**进程级**，不能放进发布器实例）。
 *
 * ⚠️ 2026-09-20 真机事故的根因：`createChartEventPublisher()` 是在**每次 `render_chart`
 * 时**惰性调用的（见 `src/index.ts` 的 `chartEvents: () => createChartEventPublisher(...)`），
 * 所以每个实例都拿到一份**自己的** `pending`。于是：
 *   1. 出图时回合是关的 → 图被寄存进**实例 A** 的 pending；
 *   2. 稍后 owner 那一轮关闭 → 冲刷回调跑在**实例 B**（甚至没有实例）上；
 *   3. B 的 pending 是空的 → 什么都没写 → 图**永久丢失**，且静默无报错。
 * 旧代码之所以看不出这个问题，是因为"回合打开时立即 append"这条路径占多数，
 * 只有"回合之间出图"（本项目的主 Agent 等子 Agent 时必然发生）才走寄存。
 *
 * 因此 pending 必须与进程内的服务实例同生命周期：模块级，并在注册冲刷监听时才清理。
 */
const pending = new Map();
/**
 * 进程内待登记条目的总量上限（安全阀）。
 *
 * 正常流程下条目会在 owner 那一轮关闭时被冲刷清空；但如果冲刷时机始终没接上
 * （上游事件名消失、监听注册失败且 turn/start 也没来），模块级 Map 会一直攒着。
 * 这是纯内存元数据（只有 chart_id / 标题 / 相对路径），上限只为防无界增长，
 * 与 `MAX_CHARTS_PER_TURN` 的"防模型循环"是两件事。
 */
export const MAX_PENDING_CHARTS = 64;
/**
 * 只给测试用：清空待登记队列。
 *
 * `pending` 是模块级的（必须跨发布器实例存活，见下方说明），因此进程内所有测试
 * 共享它。测试之间要隔离，就在用例开始时调用一次。
 */
export function resetChartEventPending() {
    pending.clear();
}
/**
 * 惰性构造发布器：`sessions` / `sessionProjections` 缺一不可（都是宿主平面服务，
 * 在 preset scope 里正常可解析；缺失表示宿主组合不完整，此时静默降级）。
 */
/**
 * 进程级单例发布器。
 *
 * ⚠️ 2026-09-20 真机事故的**真根因**：`src/index.ts` 的 `chartEvents: () => createChartEventPublisher(...)`
 * 是**每次 `render_chart` 都调用一次**的。若每次都新建发布器：
 *   1. 实例 A 出图时把图寄存进自己的队列，并注册了**绑定在 A 上**的冲刷监听；
 *   2. 下一次出图再建实例 B（又注册一套监听）；
 *   3. 冲刷回调里 `flush` 闭包引用的是某个实例的队列，而实例不断增多，
 *      寄存与冲刷落在不同实例上 —— 于是"专家确实出图，但主会话一条交付事件都没有"。
 *
 * 所以发布器必须**进程内唯一**：队列、监听、perTurn 计数都只有一份。
 * 缓存键用 `ctx.root ?? ctx`（cordis 的 root context 是稳定对象；`index.ts` 传进来的
 * 是个每次新建的 spread 字面量，不能用它做身份判断）。构造失败不缓存——宿主服务
 * 可能稍后才就绪，下次出图要能重新解析（保留原有的惰性语义）。
 */
let cachedPublisher;
export function createChartEventPublisher(ctx) {
    const ref = ctx.root ?? ctx;
    if (cachedPublisher !== undefined && cachedPublisher.ref === ref)
        return cachedPublisher.publisher;
    const publisher = buildChartEventPublisher(ctx);
    if (publisher !== undefined)
        cachedPublisher = { ref, publisher };
    return publisher;
}
/** 只给测试用：丢弃单例缓存（配合 resetChartEventPending 做用例隔离）。 */
export function resetChartEventPublisher() {
    cachedPublisher = undefined;
}
function buildChartEventPublisher(ctx) {
    const sessions = ctx.get('sessions');
    if (sessions === undefined || typeof sessions.get !== 'function')
        return undefined;
    const projections = ctx.get('sessionProjections');
    if (projections === undefined || typeof projections.stateOf !== 'function')
        return undefined;
    const perTurn = new Map();
    let warned = false;
    /**
     * 输出一条诊断。
     *
     * ⚠️ 实测（2026-09-20）：cordis 的 `ctx.logger` **只挂了一个内存 exporter**
     * （`cordis/lib/index.js` 的 `LoggerService` 构造器），全仓没有任何地方注册 console
     * exporter —— 也就是说 `ctx.logger.warn` 只进内存缓冲，**不会出现在 dsh 终端里**。
     * 这正是"卡片不出现却零报错"、两轮排查都只能靠猜的原因。
     * 因此这里**同时**写 `process.stderr`（宿主 stderr 一定能在终端看到）；
     * logger 照发，保留结构化疗日志，将来有人接 exporter 就能收到。
     */
    const emit = (message) => {
        const line = `capital-generation: ${message}`;
        try {
            ctx.logger?.warn(line);
        }
        catch {
            // logger 不可用不影响诊断输出。
        }
        try {
            const stderr = globalThis.process?.stderr;
            if (typeof stderr?.write === 'function')
                stderr.write(`${line}\n`);
        }
        catch {
            // 没有 process（非 Node 载体）时静默跳过。
        }
    };
    const warn = (message) => {
        if (warned)
            return;
        warned = true;
        emit(message);
    };
    /**
     * 进度日志（不节流、不算警告）。
     *
     * "交付行/卡片不出现"是本项目最容易反复踩的故障，而它的失败模式几乎都是**静默**的
     * （2026-09-20 两轮排查都因为没有日志只能靠猜）。所以寄存与登记这两处状态迁移每次都留痕，
     * 与失败用的 `warn` 分开：既不会被节流吞掉，也不会把正常流程标成警告。
     */
    const note = (message) => {
        emit(message);
    };
    const boundaryOf = (owner) => {
        try {
            return projections.stateOf(owner, 'turnBoundary');
        }
        catch {
            return undefined;
        }
    };
    /** 真正写一条事件；返回是否写入。 */
    const append = (owner, turn, input) => {
        const key = `${owner.id}:${turn}`;
        const used = perTurn.get(key) ?? 0;
        if (used >= MAX_CHARTS_PER_TURN) {
            warn(`图表对话流事件跳过：turn ${turn} 已达到 ${MAX_CHARTS_PER_TURN} 张上限`);
            return false;
        }
        try {
            owner.append(CHART_DELIVERABLE_EVENT, buildChartEventPayload(input, turn));
        }
        catch (error) {
            warn(`图表对话流事件写入失败（图表已落盘）：${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
        perTurn.set(key, used + 1);
        // 与"已寄存"成对的成功日志：排查交付行不出现时，一眼能看出是没写还是没渲染。
        note(`图表已登记为本轮交付（owner=${owner.id}，turn=${turn}，${input.chart_id}）`);
        return true;
    };
    /**
     * 把寄存的图表写进某一轮。
     *
     * 冲刷时机决定交付行的落点：首选 `agent/turn-stopping`（该轮即将关闭），
     * 只有在拿不到这个钩子时才退回 `turn/start`。
     */
    const flush = (ownerSessionId, turn) => {
        const queued = pending.get(ownerSessionId);
        if (queued === undefined || queued.length === 0)
            return;
        const owner = resolveOwnerSession(sessions, ownerSessionId);
        if (owner === undefined) {
            pending.delete(ownerSessionId);
            return;
        }
        pending.delete(ownerSessionId);
        for (const item of queued)
            append(owner, turn, item);
    };
    /**
     * 首选时机是否可用。
     *
     * 关键：`turn-stopping` 缺席时**必须**退回 `turn/start`，否则寄存的图会永远不写（静默丢失）。
     * 安装成功才置 true；effect 卸载时复位，避免失效后仍以为首选可用。
     */
    let turnStoppingActive = false;
    /** 不能在任何 appending 窗口内重入 append，统一延到微任务。 */
    const flushSoon = (ownerSessionId, turn) => {
        queueMicrotask(() => {
            try {
                flush(ownerSessionId, turn);
            }
            catch (error) {
                warn(`图表对话流事件冲刷失败：${error instanceof Error ? error.message : String(error)}`);
            }
        });
    };
    const listenCtx = ctx.root ?? ctx;
    if (typeof listenCtx.on === 'function') {
        const sessionEventDispose = listenCtx.on('session/event', (...args) => {
            try {
                const session = args[0];
                const event = args[1];
                if (event?.type !== 'turn/start')
                    return;
                // 首选钩子在场时，`turn/start` 不得抢跑：那一轮往往还是过程轮（2026-09-20 真机教训），
                // 交付行会被落到空轮里。只有拿不到 `agent/turn-stopping` 时才用它兜底。
                if (turnStoppingActive)
                    return;
                const sessionId = typeof session?.id === 'string' ? session.id : undefined;
                const turn = event.data?.turn;
                if (sessionId === undefined || !pending.has(sessionId))
                    return;
                if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1)
                    return;
                flushSoon(sessionId, turn);
            }
            catch {
                // 事件观察者永不抛出。
            }
        });
        if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => {
                if (typeof sessionEventDispose === 'function')
                    sessionEventDispose();
            }, 'capital-generation.chart-turn-events()');
        }
    }
    if (typeof listenCtx.onTurnStopping === 'function') {
        const disposeTurnStopping = listenCtx.onTurnStopping((...args) => {
            try {
                const payload = args[0];
                const sessionId = payload?.agent?.session?.id;
                const turn = payload?.turn;
                if (typeof sessionId !== 'string' || !pending.has(sessionId))
                    return;
                if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1)
                    return;
                flushSoon(sessionId, turn);
            }
            catch {
                // 事件观察者永不抛出。
            }
        });
        // ⚠️ 只有**真的拿到 disposer** 才算首选可用（2026-09-20 真机事故）：
        // 早先这里无条件置 true，于是 `ctx.on('agent/turn-stopping')` 注册失败
        // （适配器 catch 后返回 undefined）时，闸门仍被打开、`turn/start` 兜底被永久关掉，
        // 图就**永远滞留 pending**——表现是交付卡片从头到尾不出现，且零报错。
        // 注册失败必须让 `turnStoppingActive` 保持 false，由 `turn/start` 接上。
        if (typeof disposeTurnStopping === 'function')
            turnStoppingActive = true;
        else
            warn('交付行的首选冲刷时机不可用（agent/turn-stopping 注册失败），已退回 turn/start 兜底；落点可能偏早一轮');
        if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => {
                // 卸载即视为"首选不可用"，让 `turn/start` 兜底重新接上，避免图静默丢失。
                turnStoppingActive = false;
                if (typeof disposeTurnStopping === 'function')
                    disposeTurnStopping();
            }, 'capital-generation.chart-turn-stopping()');
        }
    }
    return {
        publish(input) {
            const trace = [];
            const owner = resolveOwnerSession(sessions, input.ownerSessionId);
            if (owner === undefined) {
                lastPublishTrace = `owner 未解析：ownerSessionId=${input.ownerSessionId}（sessions.get 拿不到可直接 append 的会话）`;
                warn(`图表对话流事件跳过：找不到 owner 会话 ${input.ownerSessionId}（图表已落盘，走 html_path 降级）`);
                return false;
            }
            trace.push(`owner=${owner.id}`);
            const boundary = boundaryOf(owner);
            const openSeq = boundary?.openTurnStartSeq;
            const lastTurn = boundary?.lastTurn;
            if (typeof openSeq !== 'number') {
                // 回合之间出图（主 Agent 等子 Agent 时会先关轮）：寄存，等 owner 那一轮
                // **即将关闭**（`agent/turn-stopping`）时再写——那才是消费这份图、写下答复的回合。
                //
                // ⚠️ 寄存队列必须按 **owner**（根会话）的 id 归档，不能按 `input.ownerSessionId`：
                // 后者是发起出图的 scope（visualization_specialist，孙会话），而冲刷时机
                // （`turn/start` / `agent/turn-stopping`）拿到的都是 owner 的 id。
                // 两边键不一致时 `flush()` 永远查不到，图会**永久滞留在 pending**、静默不登记
                // （2026-09-20 实测：3 个 specialist 会话 render_chart=2 而 deliverables=0）。
                const queued = pending.get(owner.id) ?? [];
                if (queued.length >= MAX_CHARTS_PER_TURN) {
                    warn(`图表对话流事件跳过：${owner.id} 已寄存 ${MAX_CHARTS_PER_TURN} 张，等不到新回合`);
                    return false;
                }
                // 安全阀：正常不该触发（冲刷会清空）；触发说明冲刷链路坏了，宁可丢图也要有界。
                let total = 0;
                for (const list of pending.values())
                    total += list.length;
                if (total >= MAX_PENDING_CHARTS) {
                    warn(`图表对话流事件跳过：进程内已寄存 ${total} 张仍未登记（冲刷链路异常），超出 ${MAX_PENDING_CHARTS} 上限`);
                    return false;
                }
                queued.push(input);
                pending.set(owner.id, queued);
                // 出图时回合是关的 ⇒ 走寄存。这条日志是**必要的可观测性**：它之后若没有对应的
                // "已登记" 日志，就说明冲刷时机没接上（2026-09-20 的静默丢失正是死在这里，
                // 两轮排查都因为没有日志而只能猜）。只在进程内报一次，不刷屏。
                note(`图表已寄存，待 owner 回合关闭时登记（owner=${owner.id}，lastTurn=${String(lastTurn)}，寄存 ${queued.length} 张）`);
                lastPublishTrace = `${trace.join(' ')} 回合未打开(openTurnStartSeq=${String(openSeq)} lastTurn=${String(lastTurn)}) → 已寄存 ${queued.length} 张，等 turn-stopping/turn-start 冲刷`;
                return true;
            }
            // turn 0 / 非法值表示该会话还没真正开过回合。
            if (typeof lastTurn !== 'number' || !Number.isSafeInteger(lastTurn) || lastTurn < 1) {
                lastPublishTrace = `${trace.join(' ')} 回合号非法(lastTurn=${String(lastTurn)}) → 未写入`;
                warn('图表对话流事件跳过：owner 会话没有打开中的 turn');
                return false;
            }
            const written = append(owner, lastTurn, input);
            lastPublishTrace = `${trace.join(' ')} 回合打开(turn=${lastTurn}) → ${written ? '已直接登记' : '写入失败'}`;
            return written;
        },
        /** 诊断/测试用：当前寄存未冲刷的图表数。 */
        pendingCount(ownerSessionId) {
            if (ownerSessionId !== undefined)
                return pending.get(ownerSessionId)?.length ?? 0;
            let total = 0;
            for (const list of pending.values())
                total += list.length;
            return total;
        },
    };
}
/** 出图时的 owner scope：与 chart_ref 同源（specialist 出图时正好是主会话）。 */
export function chartEventOwnerSessionId(session, sourceSession) {
    return chartSessionScopeId(sourceSession ?? session);
}
