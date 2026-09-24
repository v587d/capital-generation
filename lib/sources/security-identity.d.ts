export type EastmoneyMarket = 'SH' | 'SZ' | 'BJ';
export interface EastmoneySecurityIdentity {
    thscode: string;
    ticker: string;
    eastmoney_code: string;
    eastmoney_market: EastmoneyMarket;
}
/**
 * Resolve Eastmoney's provider identifiers without guessing a market from digits.
 * `market` is mandatory for a bare SECURITY_CODE; `secid` carries its own market.
 */
export declare function normalizeEastmoneySecurityIdentity(input: {
    secucode?: unknown;
    security_code?: unknown;
    market?: unknown;
    secid?: unknown;
}): EastmoneySecurityIdentity;
export declare function normalizeEastmoneyAshareIdentity(value: unknown): EastmoneySecurityIdentity;
export interface EastmoneyBoardIdentity {
    board_code: string;
    board_name: string;
    board_type: 'industry' | 'concept' | 'region';
}
export declare function normalizeEastmoneyBoardIdentity(codeValue: unknown, nameValue: unknown, boardType: EastmoneyBoardIdentity['board_type']): EastmoneyBoardIdentity;
