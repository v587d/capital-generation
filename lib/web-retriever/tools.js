const MAX_QUERY_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_RESULTS = 20;
const RECENT_TRACE_LIMIT = 8;
const TRACE_TEXT_CLIP = 200;
const jsonObject = (properties = {}, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
const render = (_args, value) => [
    { type: 'text', text: JSON.stringify(value) },
];
function requiredString(value, name, maxLength) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${name} is required`);
    if (value.length > maxLength)
        throw new Error(`${name} exceeds maximum length ${maxLength}`);
    return value;
}
function validHttpUrl(value) {
    const url = requiredString(value, 'url', MAX_URL_LENGTH);
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            throw new Error('only http(s) URLs are allowed');
    }
    catch (error) {
        throw new Error(`url must be a valid http(s) URL: ${error instanceof Error ? error.message : String(error)}`);
    }
    return url;
}
function integer(value, name, min, max) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}
/**
 * 检索回声：按调用方 session 维护两类只读信息——
 * 1. recent_retrievals：最近几次检索流水（跨 anysearch 与 wind_docs，上限 RECENT_TRACE_LIMIT），
 *    供模型在换 provider 前盘点已搜过什么、避免重复搜索；
 * 2. provider_tally：各 provider 的累计调用次数（不封顶），让"每个 provider 一般 5 次收敛"
 *    的经验法则变成看得见的计数器。
 * 两者都是纯提醒不拦截；内存态、不落盘，随会话消亡。WebRetriever / WindClient 保持无状态。
 */
function createRetrievalEcho() {
    const traces = new Map();
    const tallies = new Map();
    return (exec, entry) => {
        const key = exec.agent?.session?.id ?? 'default';
        const list = traces.get(key) ?? [];
        list.push({ ...entry, query: entry.query.slice(0, TRACE_TEXT_CLIP) });
        while (list.length > RECENT_TRACE_LIMIT)
            list.shift();
        traces.set(key, list);
        const counts = tallies.get(key) ?? new Map();
        counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1);
        tallies.set(key, counts);
        const tally = {};
        for (const provider of [...counts.keys()].sort())
            tally[provider] = counts.get(provider);
        return { recent: list.map((item) => ({ ...item })), tally };
    };
}
function searchOutput(result, recent, tally) {
    return {
        provider: 'anysearch',
        query: result.query,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        sources: result.sources.slice(0, MAX_RESULTS),
        recent_retrievals: recent,
        provider_tally: tally,
    };
}
function fetchOutput(result, recent, tally) {
    return {
        provider: 'anysearch',
        url: result.url,
        ok: result.ok,
        ...(result.title ? { title: result.title } : {}),
        ...(result.content ? { content: result.content, content_chars: result.content.length } : {}),
        ...(result.error ? { error: result.error } : {}),
        recent_retrievals: recent,
        provider_tally: tally,
    };
}
function windOutput(tool, query, result, recent, tally) {
    return {
        provider: 'wind_docs',
        tool,
        query,
        ok: result.ok,
        ...(result.data !== undefined ? { data: result.data } : {}),
        ...(result.content !== undefined ? { content: result.content, content_chars: result.content.length } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.code ? { code: result.code } : {}),
        recent_retrievals: recent,
        provider_tally: tally,
    };
}
const WIND_ANNOUNCEMENTS_TOOL = 'wind_docs_announcements';
const WIND_NEWS_TOOL = 'wind_docs_news';
const WIND_ANNOUNCEMENTS_UPSTREAM = 'get_company_announcements';
const WIND_NEWS_UPSTREAM = 'get_financial_news';
/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具。wind 工具无条件注册——Key 缺失/服务不可用只影响调用结果（错误信封），
 * 不影响工具注册与子 Agent 创建。
 */
export function registerWebRetrieverTools(ctx, retriever, windClient) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    const echo = createRetrievalEcho();
    const trace = (exec, provider, tool, query) => echo(exec, { provider, tool, query, at: Date.now() });
    const definitions = [
        {
            name: 'web_retriever_search',
            description: '使用 anysearch 检索网页（广度优先）：发现候选来源与线索，结果仅作为候选，不等于已核验事实。一次只提交一个查询。需要读取网页正文或核验官方归属时，必须逐个调用 web_retriever_fetch。',
            parameters: jsonObject({
                query: { type: 'string', description: '单个网页检索词，最多 500 字符' },
                max_results: { type: 'integer', description: '可选，返回来源数 1~20' },
            }, ['query']),
            output: { schema: { type: 'object', additionalProperties: true }, render },
            async execute(args, exec) {
                const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH);
                const maxResults = integer(args.max_results, 'max_results', 1, MAX_RESULTS);
                const { recent, tally } = trace(exec, 'anysearch', 'web_retriever_search', query);
                return searchOutput(await retriever.search(query, maxResults, exec.signal), recent, tally);
            },
        },
        {
            name: 'web_retriever_fetch',
            description: '使用 anysearch 抓取一个网页正文（一次只能提交一个 http(s) URL）。证券任务的 verified_official 核验只能经本工具完成：只允许抓取已由官方页面直接证明归属和用途的官方来源域名，不得 fetch 全部搜索结果。',
            parameters: jsonObject({
                url: { type: 'string', description: '单个 http(s) URL；证券任务必须是已核验的官方来源 URL' },
            }, ['url']),
            output: { schema: { type: 'object', additionalProperties: true }, render },
            async execute(args, exec) {
                const url = validHttpUrl(args.url);
                const { recent, tally } = trace(exec, 'anysearch', 'web_retriever_fetch', url);
                return fetchOutput(await retriever.fetch(url, exec.signal), recent, tally);
            },
        },
        {
            name: WIND_ANNOUNCEMENTS_TOOL,
            description: '检索 Wind 官方文档库中的上市公司公告、年报、季报、招股书等正式文件（public_document，官方文件内容的首选来源）。query 必须一次带齐三要素：公司实体（股票代码或公司全称）、文件类型、时间范围；禁止“公告 2026年9月”这类无主体泛查询。返回内容标注“来源：万得 Wind 金融数据服务”与时间口径后即可作为证据使用，不必再走官网核验；第三方媒体报道不在此范围。消耗积分，按需少量调用；返回 AUTH/RATE_LIMIT 等错误时不得重试本工具，改用 web_retriever_search 发现公告线索并 web_retriever_fetch 官方披露页。',
            parameters: jsonObject({
                query: { type: 'string', description: '自然语言检索要求；必须包含公司实体（股票代码或公司全称）、文件类型与时间范围三要素，最多 500 字符' },
                top_k: { type: 'integer', description: '可选，返回相关文档最大数量 1~10，默认 5' },
            }, ['query']),
            output: { schema: { type: 'object', additionalProperties: true }, render },
            async execute(args, exec) {
                const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH);
                const topK = integer(args.top_k, 'top_k', 1, 10);
                const { recent, tally } = trace(exec, 'wind_docs', WIND_ANNOUNCEMENTS_TOOL, query);
                const result = await windClient.callTool(WIND_ANNOUNCEMENTS_UPSTREAM, { query, ...(topK === undefined ? {} : { top_k: topK }) }, exec.signal);
                return windOutput(WIND_ANNOUNCEMENTS_TOOL, query, result, recent, tally);
            },
        },
        {
            name: WIND_NEWS_TOOL,
            description: '检索 Wind 官方文档库中的财经新闻（public_document，权威新闻内容的首选来源）。query 必须一次带齐三要素：公司实体或主题、新闻类型、时间范围；禁止无主体泛查询。返回内容标注“来源：万得 Wind 金融数据服务”与时间口径后即可作为证据使用；发行人官方公告与券商研报不在此范围。消耗积分，按需少量调用；返回 AUTH/RATE_LIMIT 等错误时不得重试本工具，改用 web_retriever_search + web_retriever_fetch。',
            parameters: jsonObject({
                query: { type: 'string', description: '自然语言检索要求；必须包含公司实体或主题、新闻类型与时间范围三要素，最多 500 字符' },
                top_k: { type: 'integer', description: '可选，返回相关文档最大数量 1~10，默认 5' },
            }, ['query']),
            output: { schema: { type: 'object', additionalProperties: true }, render },
            async execute(args, exec) {
                const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH);
                const topK = integer(args.top_k, 'top_k', 1, 10);
                const { recent, tally } = trace(exec, 'wind_docs', WIND_NEWS_TOOL, query);
                const result = await windClient.callTool(WIND_NEWS_UPSTREAM, { query, ...(topK === undefined ? {} : { top_k: topK }) }, exec.signal);
                return windOutput(WIND_NEWS_TOOL, query, result, recent, tally);
            },
        },
    ];
    for (const definition of definitions) {
        ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`);
    }
}
