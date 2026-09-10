import type { Context } from '@deepseek-ai/cordis';
import { DataCollectorHub } from './hub.js';
/** dc_status 诊断信息注入：探测凭据解析状态与最近一次注册错误（只含有无/source，不含密钥值）。 */
export interface DataCollectorDiagnostics {
    probeApiKey: () => Promise<{
        present: boolean;
        source: string | null;
        error?: string;
    }>;
    getRegistrationError: () => string | undefined;
    /** 每次 dc_status 真实执行时回调（写执行痕迹用；模型可伪造文本，但宿主文件痕迹与计数无法伪造）。 */
    onCall?: (snapshot: {
        at: number;
        call: number;
        apiKey: unknown;
        capabilities: string[];
        error: string | null;
    }) => void;
}
export declare function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void;
/** 供测试与宿主侧断言复用：模型可见的 DatasetRef 字段白名单。 */
export declare const DATASET_REF_FIELDS: readonly ["dataset_id", "task_id", "session_id", "artifact_ref", "format", "capability", "source_label", "schema", "row_count", "captured_at", "retention_until", "params_digest"];
