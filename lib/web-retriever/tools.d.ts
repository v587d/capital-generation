import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
import type { WindClient } from './wind-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
import { type WorkspaceDatasetStore } from '../data-collector/store.js';
import { type PaddleOcrClient } from '../ocr/client.js';
/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具 + `ocr`（文档解析）一工具。wind 与 ocr 都**无条件注册**——Key 缺失/服务
 * 不可用只影响调用结果（错误信封），不影响工具注册与子 Agent 创建。
 *
 * `ocr` 与 `datasetStore` 共用 workspace 落盘，而检索回声（`recent_retrievals` /
 * `provider_tally`）**必须**与另外四个工具共享同一份闭包，所以它在这同一个 `definitions`
 * 数组里注册，不另起一个注册函数。
 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient, ocr: OcrToolDependencies): void;
/** `ocr` 的两项依赖：上游客户端 + workspace 落盘（与 Dataset 共用同一份实现）。 */
export interface OcrToolDependencies {
    store: WorkspaceDatasetStore;
    client: PaddleOcrClient;
    /** 注入以便测试钉住 `created_at`。 */
    now?: () => number;
    /**
     * 注入以便测试：`url` 形态的公网性闸门默认走**真实 DNS**（与本机直连同一份实现，§9.7），
     * 生产路径不传。生产代码里没有任何调用方给它赋值——它只是把 DNS 这一步挪出断言范围。
     */
    resolveAddresses?: LocalFetchOptions['resolveAddresses'];
}
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
