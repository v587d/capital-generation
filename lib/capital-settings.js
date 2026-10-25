export const CAPITAL_CONFIG_ENTRY_ID = 'capital-config';
/**
 * Settings first, then the config-editor save layer. The selected-skill provider and the
 * persona section live in a separate preset row; reading only `settings.describe()` there
 * made a saved toggle look all-off whenever the settings projection was not ready.
 */
export function readCapitalEntry(ctx) {
    try {
        const settings = ctx.get('settings');
        const value = settings?.describe?.().find((entry) => entry?.ns === CAPITAL_CONFIG_ENTRY_ID)?.value;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            return { value: value, source: 'settings-describe' };
        }
    }
    catch {
    }
    try {
        const editor = ctx.get('configEditor');
        const value = editor?.entries?.().find((row) => row?.options?.id === CAPITAL_CONFIG_ENTRY_ID)?.options?.config;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            return { value: value, source: 'config-editor' };
        }
    }
    catch {
    }
    return {};
}
export function readCapitalConfig(ctx) {
    return (readCapitalEntry(ctx).value ?? {});
}
/** Flat credential refs needed by the collector domain (same shape as `CollectorConfig`). */
export function readCollectorConfig(ctx) {
    const config = readCapitalConfig(ctx);
    return {
        fuyaoCredentialRef: config.fuyaoCredentialRef,
        ftshareCredentialRef: config.ftshareCredentialRef,
        windCredentialRef: config.retriever?.windDocs?.credentialRef,
    };
}
/** Retriever config slice (baseURL, credential ref, Wind endpoint, local fallback switch). */
export function readRetrieverConfig(ctx) {
    return readCapitalConfig(ctx).retriever ?? {};
}
