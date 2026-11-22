import { createRequestThrottle } from '../net/throttle.js';
/**
 * Sina's report list answers HTTP 200 with a fake 「没有找到相关内容」 page when the next request
 * follows within a few seconds — indistinguishable from "this stock has no reports". Upstream
 * measured 1s → fake empty, ≥5s → normal, so keep a 6s floor between request starts.
 */
export const SINA_REPORTS_MIN_INTERVAL_MS = 6_000;
let shared;
/** One process-wide chain: every session shares the same egress IP, two throttles = none. */
export function sharedSinaReportsThrottle() {
    shared ??= createRequestThrottle(SINA_REPORTS_MIN_INTERVAL_MS);
    return shared;
}
