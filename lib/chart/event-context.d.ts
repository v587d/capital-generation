/**
 * Adapt a cordis ctx into ChartEventContext.
 * Never spread ctx (`{ ...ctx }`): get/on/effect live on the prototype, so spreading drops them
 * and delivery silently disappears. Forward each method with the original ctx as receiver.
 * One assembly path serves both the monolith plugin and the tools/chart entry.
 */
import type { ChartEventContext } from './events.js';
export declare function chartEventContextOf(ctx: unknown): ChartEventContext;
