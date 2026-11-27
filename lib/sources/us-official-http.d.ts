/** US official data sources (Treasury, NY Fed): zero-key public endpoints, one throttle per host,
 * rows are plain arrays (no upstream pagination). SEC (same file family) is added separately. */
import type { DataSource } from '../data-collector/hub.js';
export declare function createUsOfficialSources(): DataSource[];
