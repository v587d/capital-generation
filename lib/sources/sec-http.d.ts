/** SEC EDGAR sources: ticker→CIK, submissions, daily index, full-text search and XBRL frames.
 * Contract probes stay shadow until a live SEC egress passes; fixtures mirror official payloads.
 */
import type { DataSource } from '../data-collector/hub.js';
export declare function createSecSources(): DataSource[];
