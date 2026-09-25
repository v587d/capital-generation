export type SecurityMarket = 'SH' | 'SZ' | 'BJ';
export interface SecurityCode {
    digits: string;
    market: SecurityMarket;
    canonical: string;
    tencentSymbol: string;
    isIndex: boolean;
}
/**
 * Parse an A-share/ETF/index code without dropping exchange information.
 * Bare 000xxx codes are rejected because they are ambiguous (e.g. 000001).
 */
export declare function parseSecurityCode(value: unknown, name?: string): SecurityCode;
/**
 * 检索面的代码口径：只回答"把这串写法归一成 6 位数字"。
 *
 * 与 `parseSecurityCode` 的分工是刻意的：数据面必须消歧（裸 `000001` 在指数与个股之间
 * 有歧义），而**具名来源自己会回答"这台机器上有没有这只票"**——cninfo 只覆盖深市、
 * sseinfo 只覆盖沪市，越界返回 0 条并带 note 是真事实，不能在这一层把它拒掉。
 * 所以裸 `000001`（平安银行）在这里合法，`SH600519` / `600519.SH` 也合法（东财研报库
 * 实测只认纯数字，带前缀返回 0 条，因此归一化属于工具职责而不是模型的记性）。
 */
export declare function bareAshareDigits(value: unknown, name?: string): string;
/** Normalize a list while preserving first-seen order and rejecting duplicates after normalization. */
export declare function normalizeSecurityCodes(value: unknown, name?: string, maximum?: number): SecurityCode[];
export declare function requireTencentSecurity(code: SecurityCode, name?: string): SecurityCode;
export declare function isLikelyIndex(code: SecurityCode): boolean;
