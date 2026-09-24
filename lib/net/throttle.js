/**
 * 通用请求节流器：把会打到**同一上游**的请求串成一条带最小间隔的链。
 *
 * ## 为什么是"链"而不是 `await sleep()`
 *
 * 多个工具调用可能**并发**进入（模型在同一条消息里发多个调用时，框架会把它们放进并发池）。
 * 各自 sleep 之后仍会同时发出请求——间隔就白设了。串到一条 Promise 链上，才能保证
 * "上一个请求**发出后**至少 N 毫秒，下一个才发出"。链本身不会因某个任务失败而断掉。
 *
 * ## 为什么是独立的中性模块
 *
 * 它纯属**网络面**关切，不属于任何一条数据面：东财 Hub 侧（`src/sources/eastmoney-http.ts`）
 * 与 web_retriever 侧（`src/web-retriever/sources.ts`）都要用。若把它放在任一侧，另一侧就得
 * 反向依赖对方——那正是"客户端被复制"的前身（见 `src/net/eastmoney-client.ts` 的分层说明）。
 */
export function createRequestThrottle(minIntervalMs) {
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
        // 配错的节流器会静默变成"没有节流"，而上游风控不会报"你太快了"——只会封 IP 或给空数据。
        throw new Error(`createRequestThrottle: minIntervalMs must be a non-negative finite number, got ${String(minIntervalMs)}`);
    }
    let chain = Promise.resolve();
    let lastStartedAt = 0;
    return (task) => {
        const result = chain.then(async () => {
            const wait = minIntervalMs - (Date.now() - lastStartedAt);
            if (wait > 0)
                await new Promise((resolve) => setTimeout(resolve, wait));
            lastStartedAt = Date.now();
            return task();
        });
        chain = result.then(() => undefined, () => undefined);
        return result;
    };
}
