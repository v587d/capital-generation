import type { Context } from '@deepseek-ai/cordis';
/** 校验并规范化 IANA 时区名；undefined 表示宿主本地时区。'UTC'/'GMT' 为合法特殊值。 */
export declare function resolveTimeZone(timeZone: unknown): string | undefined;
/** 宿主进程的本地 IANA 时区名。 */
export declare function localTimeZone(): string;
/** 当前时刻读数（内部纯函数，便于测试）：now 为 epoch 毫秒。 */
export declare function readClock(now: number, timeZone?: string): Record<string, unknown>;
/**
 * 注册时间工具（会话组作用域：主 Agent 与所有子 Agent 均可见，与数据工具同一
 * 注册通道）。模型知识截止日期不是当前时间；涉及"今天/现在/此刻/周几"的判断
 * 必须先调用本工具，绝不凭记忆猜测。
 */
export declare function registerTimeTool(ctx: Context): void;
