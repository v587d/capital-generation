/** Official venue HTTP sources: SSE/SZSE ETF shares and CFETS repo fixings. One throttle chain per
 * upstream; row keys are remapped explicitly (§10.6) and 万份 is converted to 份 at this boundary. */
import type { DataSource } from '../data-collector/hub.js';
export declare function createOfficialSources(): DataSource[];
