/**
 * Single source of Capital preset identity. Since 0.2.1 the preset id is the role
 * identity used by root convergence, shell guards, role surfaces, diagnostics and tests.
 * These strings must match `preset/capital-generation/agent.patch.yml` `config.id` and
 * delegation `agentPreset` values; `config.id` is also session-log identity, so do not
 * rename casually. `test/persona.test.mjs` cross-checks them.
 */
export declare const ROOT_PRESET_ID = "capital-generation";
export declare const ROLE_PRESET_IDS: {
    readonly collector: "capital-data-collector";
    readonly junior: "capital-data-junior";
    readonly specialist: "capital-visualization-specialist";
    readonly retriever: "capital-web-retriever";
    readonly analyst: "capital-data-analyst";
};
export type RolePresetId = (typeof ROLE_PRESET_IDS)[keyof typeof ROLE_PRESET_IDS];
/** Role preset ids (array form avoids prototype-method coupling). */
export declare const ROLE_PRESET_ID_LIST: readonly string[];
/** Every preset claimed by this plugin: root plus five roles. */
export declare const CAPITAL_PRESET_IDS: readonly string[];
export declare function isCapitalPresetId(id: string | undefined): boolean;
/**
 * Which preset may use which tool (enforced by `src/tool-exec.ts`). This replaces the old
 * session-topology check, which rejected manually opened role sessions.
 *
 * The root preset must never appear in any set. These lists live at `src/` root because
 * data and chart layers must not depend on the agents layer.
 */
export declare const DATA_COLLECTION_PRESET_IDS: readonly string[];
export declare const DATASET_READING_PRESET_IDS: readonly string[];
/** May issue `chart_source_ref` for chart reads. */
export declare const CHART_SOURCE_PRESET_IDS: readonly string[];
