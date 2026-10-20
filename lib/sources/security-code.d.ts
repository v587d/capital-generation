export type SecurityMarket = 'SH' | 'SZ' | 'BJ';
export interface SecurityCode {
    digits: string;
    market: SecurityMarket;
    canonical: string;
    tencentSymbol: string;
    isIndex: boolean;
}
/** Parse an A-share/ETF/index code; bare 000xxx is rejected as ambiguous (000001). */
export declare function parseSecurityCode(value: unknown, name?: string): SecurityCode;
/**
 * Search-side code normalization: reduce a spelling to 6 digits.
 * Unlike `parseSecurityCode`, bare `000001` is legal: named sources cover one exchange
 * (cninfo SZ-only, sseinfo SH-only) and must be allowed to answer "no rows" themselves.
 * Eastmoney research reports accept digits only; prefixed input returns 0 rows.
 */
export declare function bareAshareDigits(value: unknown, name?: string): string;
/** Dedupe after normalization, preserving first-seen order. */
export declare function normalizeSecurityCodes(value: unknown, name?: string, maximum?: number): SecurityCode[];
export declare function requireTencentSecurity(code: SecurityCode, name?: string): SecurityCode;
export declare function isLikelyIndex(code: SecurityCode): boolean;
