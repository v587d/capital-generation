import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
import type { WindClient } from './wind-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具。wind 工具无条件注册——Key 缺失/服务不可用只影响调用结果（错误信封），
 * 不影响工具注册与子 Agent 创建。
 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient): void;
/**
 * 一次具名来源输出的字符预算：取宿主 tool-result 剪枝阈值的 75%。
 * 阈值配在 `preset/capital-generation/agent.cordis.yml` 的 `thresholdChars: 8192`
 * （由 `test/persona.test.mjs` 钉住与本常量同源）。超过阈值的工具结果在会话历史里会被
 * `dsh-compaction-tool-result-pruner` 换成 head 4096 + `[... middle pruned ...]` + tail 1024，
 * 也就是**中间条目被无声吃掉**，而留在头部的 `count` 还写着原来的条数。
 * 留 25% 余量的做法与数据面能力目录的预算同一口径（`test/data-collector-hub.test.mjs`）。
 */
export declare const SOURCE_OUTPUT_BUDGET_CHARS = 6144;
/**
 * 注册九个具名来源工具（provider + operation 命名）。
 *
 * 为什么单独一个注册函数：这九个工具只依赖 HTTP 传输（`local-fetch` 的出口校验），
 * 不依赖 AnySearch / Wind；任何一路的配置缺失都不应连带影响另外几路的注册。
 *
 * `enabled`（设置卡片「允许启动本地提取网页内容」）**同时支配这九个工具的执行**：
 * 关闭时工具仍在注册面（不静默消失），但每次调用响亮失败并说明开关位置——
 * 卡片文案的字面语义对模型与用户都成立，用户同意不被旁路。
 */
export declare function registerSourceTools(ctx: Context, localFetchOptions: LocalFetchOptions & {
    enabled?: boolean;
}): void;
