/**
 * Catalog shard key for every model-visible capability. One table, not one field per
 * source: the nine shards must be audited together, and a missing production entry is a
 * test failure rather than a capability that silently falls into `meta`.
 */
export declare const CATALOG_TOPICS: readonly ["quote", "flow", "financials", "fund", "events", "macro", "futures", "cross", "meta"];
export type CatalogTopic = (typeof CATALOG_TOPICS)[number];
export declare const CATALOG_TOPIC_LABELS: Record<CatalogTopic, string>;
/**
 * Keep this table explicit. Deriving a topic from a name prefix looks convenient until
 * `dragon_tiger` lands in `quote` or `eastmoney_mutual_flow` lands in `flow` instead of
 * `cross`; both are discovery-time failures, not cosmetic mislabels.
 */
export declare const CATALOG_TAXONOMY: Record<string, CatalogTopic>;
/** Fallback exists only for test fixtures; assembly rejects any production capability not in the table. */
export declare function topicOf(capability: string): CatalogTopic;
