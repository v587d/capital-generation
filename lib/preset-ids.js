/**
 * Single source of Capital preset identity. Since 0.2.1 the preset id is the role
 * identity used by root convergence, shell guards, role surfaces, diagnostics and tests.
 * These strings must match `preset/capital-generation/agent.patch.yml` `config.id` and
 * delegation `agentPreset` values; `config.id` is also session-log identity, so do not
 * rename casually. `test/persona.test.mjs` cross-checks them.
 */
export const ROOT_PRESET_ID = 'capital-generation';
export const ROLE_PRESET_IDS = {
    collector: 'capital-data-collector',
    junior: 'capital-data-junior',
    specialist: 'capital-visualization-specialist',
    retriever: 'capital-web-retriever',
    analyst: 'capital-data-analyst',
};
/** Role preset ids (array form avoids prototype-method coupling). */
export const ROLE_PRESET_ID_LIST = Object.values(ROLE_PRESET_IDS);
/** Every preset claimed by this plugin: root plus five roles. */
export const CAPITAL_PRESET_IDS = [ROOT_PRESET_ID, ...ROLE_PRESET_ID_LIST];
const CAPITAL_PRESET_ID_SET = new Set(CAPITAL_PRESET_IDS);
export function isCapitalPresetId(id) {
    return id !== undefined && CAPITAL_PRESET_ID_SET.has(id);
}
/**
 * Roles reached only through delegation. They stay registered because delegation rows resolve
 * `config.id`, but the host roster filter hides them from the new-session selector.
 */
export const INTERNAL_ROLE_PRESET_IDS = [
    ROLE_PRESET_IDS.junior,
    ROLE_PRESET_IDS.specialist,
];
const INTERNAL_ROLE_PRESET_ID_SET = new Set(INTERNAL_ROLE_PRESET_IDS);
export function isInternalRolePresetId(id) {
    return typeof id === 'string' && INTERNAL_ROLE_PRESET_ID_SET.has(id);
}
/**
 * Which preset may use which tool (enforced by `src/tool-exec.ts`). This replaces the old
 * session-topology check, which rejected manually opened role sessions.
 *
 * The root preset must never appear in any set. These lists live at `src/` root because
 * data and chart layers must not depend on the agents layer.
 */
export const DATA_COLLECTION_PRESET_IDS = [ROLE_PRESET_IDS.collector];
export const DATASET_READING_PRESET_IDS = [ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.analyst];
/** May issue `chart_source_ref` for chart reads. */
export const CHART_SOURCE_PRESET_IDS = [ROLE_PRESET_IDS.junior];
