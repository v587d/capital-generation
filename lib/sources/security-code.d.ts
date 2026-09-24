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
/** Normalize a list while preserving first-seen order and rejecting duplicates after normalization. */
export declare function normalizeSecurityCodes(value: unknown, name?: string, maximum?: number): SecurityCode[];
export declare function requireTencentSecurity(code: SecurityCode, name?: string): SecurityCode;
export declare function isLikelyIndex(code: SecurityCode): boolean;
