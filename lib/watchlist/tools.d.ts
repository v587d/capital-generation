import type { Context } from '@deepseek-ai/cordis';
/** Slice of the host-plane `capitalWatchlist` service this tool reads; writes happen only in the panel. */
interface WatchlistRow {
    readonly thscode?: string;
    readonly name?: string;
    readonly asset_type?: string;
    readonly added_at?: number;
    readonly pinned_at?: number;
    readonly holding?: {
        readonly weight_pct?: number | null;
        readonly marked_at?: number;
    };
}
interface WatchlistListResult {
    readonly ok?: boolean;
    readonly items?: WatchlistRow[];
    readonly limit?: number;
}
interface WatchlistServiceLike {
    list?(): Promise<WatchlistListResult>;
}
declare function render(_args: unknown, value: unknown): Array<{
    type: 'text';
    text: string;
}>;
export declare function watchlistReceipt(rows: WatchlistRow[], limit: number | undefined, now: number): Record<string, unknown>;
export declare function watchlistToolDefinition(source: () => WatchlistServiceLike | undefined): {
    name: string;
    description: string;
    parameters: object;
    output: {
        schema: object;
        render: typeof render;
    };
    execute(): Promise<Record<string, unknown>>;
};
/**
 * Register get_watchlist (main agent + all children; the subagent row must deny it). Host-level user
 * data: read it only through the host service, never a second store.
 */
export declare function registerWatchlistTool(ctx: Context): void;
export {};
