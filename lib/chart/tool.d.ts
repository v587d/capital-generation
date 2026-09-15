/**
 * `render_chart`：把已经取到的数据渲染成图，**只回一条小回执**。
 *
 * 上下文经济学（这是本工具存在的理由）：
 *  - 常驻成本 = 一条工具 schema；协议细节在 skill `capital-chart-protocol` 里按需加载；
 *  - 每次调用成本 = spec（几十到一百多 token）+ 回执（几十 token）；
 *  - 序列数据 **0 token**：由宿主写进 workspace 产物，浏览器走旁路取。
 * 对照：让模型把 250 点日线写进参数 ≈ 5–8k token，还会被工具结果剪枝器截断。
 *
 * 权限边界（AGENTS.md「数据调度纪律」的显式豁免）：本工具是**呈现**工具，不是数据工具。
 * 它读 Dataset 只在宿主进程内进行，回执不含任何 rows —— 因此不越过"数据内容不进主 Agent
 * 上下文"这条真正的边界。需要数值结论仍走 data_junior 的 profile / query。
 */
import type { Context } from '@deepseek-ai/cordis';
import { WorkspaceDatasetStore } from '../data-collector/store.js';
type AgentExecutionLike = {
    session?: {
        id?: string;
        header?: {
            cwd?: string;
            parentSession?: string;
        };
    };
};
type ToolExecLike = {
    agent?: AgentExecutionLike;
    signal: AbortSignal;
};
export declare const CHART_ARTIFACT_DIR = "capital-analysis/charts";
/** 回执字段全部是可以进上下文的小元数据；序列本体永远不在这里。 */
export interface ChartReceipt {
    chart_id: string;
    kind: string;
    axis: 'time' | 'index';
    title: string;
    points: number;
    original_points: number;
    downsampled: boolean;
    series_labels: string[];
    has_volume: boolean;
    markers: number;
    dataset_id: string | null;
    source_label: string | null;
    captured_at: number | null;
    chart_url: string | null;
    spec_path: string;
    series_path: string;
    html_path: string;
    warnings: string[];
}
export interface ChartPublisher {
    publish(input: {
        chartId: string;
        filePath: string;
    }): string;
}
export interface RenderChartInput {
    store: WorkspaceDatasetStore;
    /**
     * 惰性解析 host 平面图表服务（`@v587d/capital-charts` 提供）。
     *
     * 每次画图时解析，而不是在 `apply` 时解析一次：host 平面行与本 preset 行的挂载先后
     * 不由我们决定，一次性解析会把"服务稍后才可用"永久固化成 `chart_url=null`。
     * 服务始终缺席（未安装/无 Web 载体/坏掉）时返回 undefined，整条链路照常降级：产物照样
     * 落盘、`html_path` 照样可 present，只是 `chart_url` 为 null。
     */
    charts?: () => ChartPublisher | undefined;
    now?: () => number;
}
export declare function renderChart(input: RenderChartInput, args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt>;
export declare function registerChartTool(ctx: Context, options: RenderChartInput): void;
export {};
