import { registerWatchlistTool } from './watchlist/tools.js';
export const name = 'capital-watchlist-tools';
export const inject = ['tools'];
export function apply(ctx) {
    registerWatchlistTool(ctx);
}
