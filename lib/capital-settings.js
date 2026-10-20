export const CAPITAL_CONFIG_ENTRY_ID = 'capital-config';
export function readCapitalConfig(ctx) {
    try {
        const settings = ctx.get('settings');
        return settings?.describe?.().find((entry) => entry?.ns === CAPITAL_CONFIG_ENTRY_ID)?.value ?? {};
    }
    catch {
        return {};
    }
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
