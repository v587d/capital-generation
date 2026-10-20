/**
 * Shared watchlist type and holding rules for host and browser.
 *
 * One implementation prevents the panel and host from disagreeing silently.
 * ⛔ Listed in package.json `files`; packaging.test.mjs pins that because local
 * tests pass even when the installed plugin cannot resolve this module.
 */
export const ASSET_TYPES = ['a-share', 'a-share-index', 'fund-etf', 'hk-stock', 'hk-index', 'us-stock', 'us-index']

/** Holdable is an allow-list, not "exclude indices"; future asset types gain no entry until added here. */
export const HOLDABLE_ASSET_TYPES = ['a-share', 'fund-etf', 'hk-stock', 'us-stock']

/** Type-only eligibility; unmarking an existing holding follows a separate path. */
export const isHoldable = (row) => HOLDABLE_ASSET_TYPES.includes(row?.asset_type)

/** Per-symbol cap in percentage points. */
export const MAX_ROW_WEIGHT_PCT = 100

/** Portfolio cap: 120 pp for long-only reporting. Host, row gate, stepper and tool text share this rule. */
export const MAX_TOTAL_WEIGHT_PCT = 120

/** Held without a weight contributes 0 but remains visually distinct from an explicit zero. */
export const holdingWeight = (row) => (
  row?.holding === null || row?.holding === undefined ? 0 : (row?.holding?.weight_pct ?? 0)
)

/** Remaining-portfolio subtraction shared by panel and host. */
export const otherHeldWeightPct = (rows, thscode) => rows.reduce(
  (total, row) => (row?.thscode === thscode ? total : total + holdingWeight(row)),
  0,
)

/** Ceiling used by the stepper and host validator: min(per-row cap, remaining portfolio). */
export const weightCeiling = (rows, thscode) => Math.max(
  0,
  Math.min(MAX_ROW_WEIGHT_PCT, MAX_TOTAL_WEIGHT_PCT - otherHeldWeightPct(rows, thscode)),
)
