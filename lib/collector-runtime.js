import { provideDataCollectorHub } from './data-collector/hub.js';
import { capitalDatasetStore } from './runtime.js';
import { rootPolicyProbes } from './agents/root-tool-policy.js';
import { rolePolicyProbes } from './agents/role-tool-policy.js';
import { createTencentSources } from './sources/tencent-http.js';
import { createEastmoneySources } from './sources/eastmoney-http.js';
import { createSinaSources } from './sources/sina-http.js';
import { createOfficialSources } from './sources/official-http.js';
import { createUsOfficialSources } from './sources/us-official-http.js';
import { createCsindexSources } from './sources/csindex-http.js';
import { createThsSources } from './sources/ths-http.js';
import { createPythonSources } from './sources/python-remote.js';
import { createFuyaoRestSources, resolveFuyaoApiKey } from './sources/fuyao-rest.js';
import { createFtshareSources, resolveFtshareApiKey } from './sources/ftshare-rest.js';
import { createWindSources } from './sources/wind-mcp.js';
import { createWindCredentialResolver } from './retriever-runtime.js';
function diagnosticsFor(ctx, config) {
    const fuyaoCredentialRef = config.fuyaoCredentialRef || 'FUYAO_API_KEY';
    return {
        probeApiKey: async () => {
            try {
                const credentials = ctx.get('credentials');
                if (credentials?.resolve) {
                    const resolved = await credentials.resolve(fuyaoCredentialRef);
                    if (resolved?.value)
                        return { present: true, source: resolved.source ?? `credentials(${fuyaoCredentialRef})` };
                }
                const processLike = globalThis.process;
                if (processLike?.env?.[fuyaoCredentialRef])
                    return { present: true, source: `env(${fuyaoCredentialRef})` };
                return { present: false, source: null };
            }
            catch (error) {
                return { present: false, source: null, error: error instanceof Error ? error.message : String(error) };
            }
        },
        // dc_status readout for root/role convergence; desktop does not persist host logs.
        // Keep the real session shape: opened root and delegated child converge differently.
        rootPolicy: () => [
            ...rootPolicyProbes().map((probe) => ({ ...probe, allowed: [] })),
            ...rolePolicyProbes().map((probe) => ({
                agentId: probe.agentId,
                root: probe.root,
                presetId: probe.presetId,
                outcome: probe.outcome,
                // Scoped tools come from family rows; host-global tools are gated by the
                // role allow-list (not model-visible). `allowed` stays empty in this readout.
                allowed: [],
                denied: probe.denied,
                failed: probe.failed,
            })),
        ],
    };
}
/**
 * Python data capabilities resolve the `pythonRuntime` service per call: the row is opt-in and the
 * pack may be missing, so a boot-time lookup would either hide the capabilities or fail the plugin.
 * A missing service is reported as the runtime's own "not ready" code so the six capabilities all
 * carry the same install hint (§9.7: external state at call time, failures are never memoized).
 */
function pythonRunnerFrom(ctx) {
    return async (request) => {
        const manager = ctx.get('pythonRuntime');
        if (manager === undefined) {
            throw Object.assign(new Error('私有 Python 运行时未加载（python-runtime 行未启用或尚未装配）；请在插件设置 → 分析环境里安装 base pack'), { code: 'data-runtime-not-ready' });
        }
        return await manager.runDataScript(request);
    };
}
/** Registers all sources; registration is structural, credentials and the python runtime resolve per call. */
function registerSources(ctx, hub, config) {
    ctx.effect(() => {
        const sources = createTencentSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个腾讯数据源（tencent_*）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.tencent-sources()');
    ctx.effect(() => {
        const sources = createEastmoneySources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个东方财富数据源（eastmoney_*）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.eastmoney-sources()');
    ctx.effect(() => {
        const sources = createSinaSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个新浪数据源（sina_*：ETF 期权 + A50）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.sina-sources()');
    ctx.effect(() => {
        const sources = createOfficialSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个交易所/货币网官方数据源（official_*：ETF 份额 + 回购定盘）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.official-sources()');
    ctx.effect(() => {
        const sources = createUsOfficialSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个美国官方数据源（us_treasury_yield_curve / nyfed_reference_rates）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.us-official-sources()');
    ctx.effect(() => {
        const sources = createThsSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个同花顺网页直连数据源（ths_*：热榜 + 涨停揭秘）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.ths-sources()');
    ctx.effect(() => {
        const sources = createCsindexSources();
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个中证指数数据源（csindex_*：指数估值）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.csindex-sources()');
    ctx.effect(() => {
        const sources = createPythonSources(pythonRunnerFrom(ctx));
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个私有 Python 数据源（baostock_* / pbc_*，运行时调用期现取）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.python-sources()');
    ctx.effect(() => {
        const sources = createFuyaoRestSources(() => resolveFuyaoApiKey(ctx, config.fuyaoCredentialRef || 'FUYAO_API_KEY'));
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个同花顺数据源（key 每次调用现取）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.fuyao-sources()');
    ctx.effect(() => {
        const sources = createFtshareSources(() => resolveFtshareApiKey(ctx, config.ftshareCredentialRef || 'FTSHARE_API_KEY'));
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个 FTShare 数据源（ftshare_*，key 每次调用现取）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.ftshare-sources()');
    const wind = createWindCredentialResolver(ctx, config.windCredentialRef);
    ctx.effect(() => {
        const sources = createWindSources(wind.resolve);
        const disposers = sources.map((dataSource) => hub.registerSource(dataSource));
        ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个 Wind 数据源（wind_*，与 wind_docs 共用 ${wind.credentialRef}）`);
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'capital-generation.wind-sources()');
}
export function createCollectorRuntime(ctx, config = {}) {
    const store = capitalDatasetStore(ctx);
    // The collector preset isolates these services; keep them in the realm to avoid
    // process-wide name collisions across presets.
    ctx.provide('datasetStore', store);
    const hub = provideDataCollectorHub(ctx, { store });
    registerSources(ctx, hub, config);
    // Builds runtime only; model tools belong to the `tools/collect` and `tools/time` rows.
    return { store, hub, diagnostics: diagnosticsFor(ctx, config) };
}
