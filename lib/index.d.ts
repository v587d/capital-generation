import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type SelectedSkillSelection } from './agents/selected-skills-provider.js';
import { type RetrieverConfig } from './retriever-config.js';
export { LOCAL_FETCH_DEFAULTS, PADDLE_OCR_DEFAULTS, resolveLocalFetchConfig, type LocalFetchConfig, type PaddleOcrConfig, type RetrieverConfig, type WindDocsConfig, } from './retriever-config.js';
export { resolveUserCustomizationSection } from './user-customization.js';
export declare const name = "capital-generation";
/** Entry id shared by `cordis.patch.yml`, `config/index.js` and `client.src.cjs`; drift hides the settings card. */
export declare const CAPITAL_CONFIG_ENTRY_ID = "capital-config";
export interface Config {
    customPersona?: string;
    selectedSkills?: SelectedSkillSelection;
    fuyaoCredentialRef?: string;
    ftshareCredentialRef?: string;
    retriever?: RetrieverConfig;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    customPersona: z<string, string, "defined">;
    selectedSkills: z<Schemastery.ObjectS<NoInfer<{
        [k: string]: z<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        [k: string]: z<boolean, boolean, "defined">;
    }>>, "defined">;
    fuyaoCredentialRef: z<string, string, "defined">;
    ftshareCredentialRef: z<string, string, "defined">;
    retriever: z<Schemastery.ObjectS<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    customPersona: z<string, string, "defined">;
    selectedSkills: z<Schemastery.ObjectS<NoInfer<{
        [k: string]: z<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        [k: string]: z<boolean, boolean, "defined">;
    }>>, "defined">;
    fuyaoCredentialRef: z<string, string, "defined">;
    ftshareCredentialRef: z<string, string, "defined">;
    retriever: z<Schemastery.ObjectS<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, "defined">;
}>>, "plain">;
export type CapitalSettingsSource = 'settings-describe' | 'config-editor' | 'preset';
/** Fallback order: settings.describe → configEditor.entries → boot preset, so unreadable never
 * reads as "all toggles off". Resolve services per call: boot fibers apply in parallel. */
export declare function readCapitalSettings(ctx: Context, bootConfig: Config): {
    config: Config;
    source: CapitalSettingsSource;
};
/** `systemPrompt` is a hard dependency of the optional persona section. */
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
