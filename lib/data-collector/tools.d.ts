import type { Context } from '@deepseek-ai/cordis';
import { DataCollectorHub } from './hub.js';
/** dc_status 诊断信息注入：探测凭据解析状态（只含有无/source，不含密钥值）。 */
export interface DataCollectorDiagnostics {
    probeApiKey: () => Promise<{
        present: boolean;
        source: string | null;
        error?: string;
    }>;
    /**
     * 根 Agent 工具收敛的现场记录（`src/agents/root-tool-policy.ts` 的 `RootPolicyProbe`）。
     * 结构在这里重述一份（不按 import 拿类型）：data_collector 不该依赖 agents 层。
     */
    rootPolicy?: () => Array<{
        agentId: string | undefined;
        root: boolean;
        presetId: string;
        outcome: string;
        denied: string[];
        failed: string[];
    }>;
    /** 每次 dc_status 真实执行时回调（写执行痕迹用；模型可伪造文本，但宿主文件痕迹与计数无法伪造）。 */
    onCall?: (snapshot: {
        at: number;
        call: number;
        apiKey: unknown;
        capabilities: string[];
    }) => void;
}
export declare function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void;
/** 供测试与宿主侧断言复用：模型可见的 DatasetRef 字段白名单。 */
export declare const DATASET_REF_FIELDS: readonly ["dataset_id", "task_id", "session_id", "artifact_ref", "format", "capability", "source_label", "schema", "row_count", "captured_at", "retention_until", "params_digest"];
