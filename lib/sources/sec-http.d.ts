/** SEC EDGAR sources: ticker→CIK, submissions, daily index and full-text search.
 *
 * ⛔ Not wired into `createUsOfficialSources()` yet: SEC rate-limited this egress (Akamai 403
 * "Request Rate Threshold Exceeded") while the code was written, so field mappings are still
 * awaiting live-payload verification. Wire it in only after `npm run contract:probe -- --only sec`
 * passes against real responses; a guard that rejects the official sample is a real incident (§10.2).
 */
import type { DataSource } from '../data-collector/hub.js';
export declare function createSecSources(): DataSource[];
