# 同花顺 iFind 数据源集成计划

## 背景

当前 `china/` 目录下的金融数据层仅依赖两个免费开源数据源：
- **akshare-mcp** — A 股行情/财报/行业/指数（基于东方财富）
- **china-news-mcp** — 财经新闻和公告

需要集成同花顺 iFind 作为**付费级数据源**，同时保留 AkShare 作为免费备选。架构需支持后续扩展更多数据商（如 Wind、Tushare、聚宽等）。

## 需求分析

### 1. iFind MCP Server
- 在 `china/mcp-servers/ifind-mcp/` 下创建标准 MCP Server
- 复用 `ifind-finance-data-1.1.0/` 的 `call.py` / `call-node.js` 调用逻辑
- 封装为 FastMCP stdio/SSE 服务，与现有 akshare-mcp 架构对齐
- 覆盖 iFind 7 大服务域：stock / fund / edb / news / bond / global_stock / index
- 密钥通过 `mcp_config.json` 管理，支持环境变量覆盖

### 2. Skill 层更新
- 更新 `china-market-data` SKILL.md，增加 iFind 作为 **Tier-1 付费数据源**
- 定义数据源优先级策略：iFind（付费精确数据）> AkShare（免费备选）
- 保持 AkShare 工具不变，确保向后兼容

### 3. Agent Prompt 更新
- 4 个 Agent 的 `tools` frontmatter 增加 `mcp__ifind__*`
- Workflow 中增加 iFind 数据获取指引
- 更新数据源优先级说明

### 4. Managed Agent Cookbook 更新
- 4 个 `agent.yaml` 增加 ifind mcp_toolset 和 mcp_server 配置
- 增加 `IFIND_MCP_URL` / `IFIND_AUTH_TOKEN` 环境变量引用

### 5. 文档与校验更新
- CLAUDE.md 增加 iFind MCP 启动说明
- README.md 更新数据层表格
- check-china.py 增加 ifind-mcp 校验

## 任务清单

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 创建 iFind MCP Server | `china/mcp-servers/ifind-mcp/server.py` | ✅ 完成 |
| 2 | 创建 iFind MCP requirements | `china/mcp-servers/ifind-mcp/requirements.txt` | ✅ 完成 |
| 3 | 创建 iFind MCP config 模板 | `china/mcp-servers/ifind-mcp/mcp_config.json` | ✅ 完成 |
| 4 | 更新 china-market-data skill | `china/vertical-plugins/china-finance/skills/china-market-data/SKILL.md` | ✅ 完成 |
| 5 | 更新 china-earnings-reviewer agent | `china/agent-plugins/china-earnings-reviewer/agents/china-earnings-reviewer.md` | ✅ 完成 |
| 6 | 更新 china-market-researcher agent | `china/agent-plugins/china-market-researcher/agents/china-market-researcher.md` | ✅ 完成 |
| 7 | 更新 china-model-builder agent | `china/agent-plugins/china-model-builder/agents/china-model-builder.md` | ✅ 完成 |
| 8 | 更新 china-pitch-agent agent | `china/agent-plugins/china-pitch-agent/agents/china-pitch-agent.md` | ✅ 完成 |
| 9 | 更新 4 个 managed-agent agent.yaml | `china/managed-agent-cookbooks/*/agent.yaml` | ✅ 完成 |
| 10 | 更新 CLAUDE.md | `china/CLAUDE.md` | ✅ 完成 |
| 11 | 更新 README.md | `china/README.md` | ✅ 完成 |
| 12 | 更新 check-china.py | `china/scripts/check-china.py` | ✅ 完成 |
| 13 | 运行 check-china.py 验证 | — | ✅ 通过 |

## 架构设计：可扩展数据源层

```
mcp-servers/
├── akshare-mcp/       # 免费 — A 股基础数据（保留）
├── china-news-mcp/    # 免费 — 新闻公告（保留）
├── ifind-mcp/         # 付费 — 同花顺 iFind（新增）
└── [future]-mcp/      # 预留 — Wind / Tushare / 聚宽等
```

数据源优先级策略（在 skill 中定义）：
1. **iFind** — 精确财务、宏观经济、债券、港美股、ESG（需密钥）
2. **AkShare** — 基础行情、行业分类、指数（免费无限制）
3. **china-news** — 新闻和公告（免费）

## iFind MCP Server 工具映射

| MCP 工具名 | iFind server_type | iFind tool_name |
|-----------|-------------------|-----------------|
| `ifind_search_stocks` | stock | search_stocks |
| `ifind_get_stock_summary` | stock | get_stock_summary |
| `ifind_get_stock_info` | stock | get_stock_info |
| `ifind_get_stock_shareholders` | stock | get_stock_shareholders |
| `ifind_get_stock_financials` | stock | get_stock_financials |
| `ifind_get_risk_indicators` | stock | get_risk_indicators |
| `ifind_get_stock_events` | stock | get_stock_events |
| `ifind_get_esg_data` | stock | get_esg_data |
| `ifind_search_funds` | fund | search_funds |
| `ifind_get_fund_profile` | fund | get_fund_profile |
| `ifind_get_fund_market_performance` | fund | get_fund_market_performance |
| `ifind_get_fund_ownership` | fund | get_fund_ownership |
| `ifind_get_fund_portfolio` | fund | get_fund_portfolio |
| `ifind_get_fund_financials` | fund | get_fund_financials |
| `ifind_get_fund_company_info` | fund | get_fund_company_info |
| `ifind_search_edb` | edb | search_edb |
| `ifind_get_edb_data` | edb | get_edb_data |
| `ifind_search_news` | news | search_news |
| `ifind_search_notice` | news | search_notice |
| `ifind_search_trending_news` | news | search_trending_news |
| `ifind_bond_basic_info` | bond | bond_basic_info |
| `ifind_bond_market_data` | bond | bond_market_data |
| `ifind_bond_financial_data` | bond | bond_financial_data |
| `ifind_bond_special_data` | bond | bond_special_data |
| `ifind_search_global_stocks` | global_stock | search_global_stocks |
| `ifind_global_stock_profile` | global_stock | global_stock_profile |
| `ifind_global_stock_quotes` | global_stock | global_stock_quotes |
| `ifind_global_stock_financial` | global_stock | global_stock_financial |
| `ifind_global_stock_events` | global_stock | global_stock_events |
| `ifind_index_data` | index | index_data |
| `ifind_sector_data` | index | sector_data |

---

## 万得 Wind 数据源集成（Tier-0）

### 背景

在 iFind 集成完成后，进一步集成万得 Wind 作为最高优先级数据源（Tier-0）。Wind 是中国金融数据行业的标杆，覆盖面最广、数据最全面。

### Wind MCP Server

- 路径：`china/mcp-servers/wind-mcp/`
- 架构：Python FastMCP 封装万得远程 JSON-RPC 2.0 API
- 基地址：`https://mcp.wind.com.cn`
- 认证：`Authorization: Bearer <WIND_API_KEY>`（Key 格式以 `ak_` 开头）
- 工具数：44 个，覆盖 8 大服务域（stock_data 10 + global_stock_data 10 + fund_data 10 + index_data 6 + bond_data 4 + financial_docs 2 + economic_data 1 + analytics_data 1）
- SSE 默认端口：8003
- 密钥申请：https://aifinmarket.wind.com.cn/#/home

### 工具映射表

#### stock_data — A 股 (10 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_search_stocks` | `search_stocks` | A股智能选股筛选 |
| `wind_get_stock_price_indicators` | `get_stock_price_indicators` | 最新行情快照（最新价、涨跌幅、换手率等） |
| `wind_get_stock_kline` | `get_stock_kline` | 历史K线（日/周/月，复权方式可选） |
| `wind_get_stock_quote` | `get_stock_quote` | 日内分钟行情 |
| `wind_get_stock_basicinfo` | `get_stock_basicinfo` | 公司档案、主营、行业、IPO、上市板 |
| `wind_get_stock_fundamentals` | `get_stock_fundamentals` | 财务数据：盈利、资产负债、现金流、增长率 |
| `wind_get_stock_equity_holders` | `get_stock_equity_holders` | 股本、前十大股东、实控人、限售 |
| `wind_get_stock_events` | `get_stock_events` | 重大事件：IPO、增发、并购、ST、分红 |
| `wind_get_stock_technicals` | `get_stock_technicals` | 技术指标：MACD、KDJ、RSI、BOLL、融资融券 |
| `wind_get_risk_metrics` | `get_risk_metrics` | 风险指标：Beta、Alpha、波动率、Sharpe、VaR |

#### global_stock_data — 港股/美股 (10 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_search_global_stocks` | `search_global_stocks` | 港股/美股智能选股筛选 |
| `wind_get_global_stock_price_indicators` | `get_global_stock_price_indicators` | 最新行情快照 |
| `wind_get_global_stock_kline` | `get_global_stock_kline` | 历史K线 |
| `wind_get_global_stock_quote` | `get_global_stock_quote` | 日内分钟行情 |
| `wind_get_global_stock_basicinfo` | `get_global_stock_basicinfo` | 公司档案、注册地、经营范围、指数成份 |
| `wind_get_global_stock_fundamentals` | `get_global_stock_fundamentals` | 财务数据：盈利、PE/PB/PS、营收、历史分位 |
| `wind_get_global_stock_equity_holders` | `get_global_stock_equity_holders` | 股本、主要股东、机构持仓、限售解禁 |
| `wind_get_global_stock_events` | `get_global_stock_events` | 重大事件：IPO、增发、并购、监管、分红 |
| `wind_get_global_stock_technicals` | `get_global_stock_technicals` | 技术指标：多周期涨跌幅、MACD、KDJ、RSI |
| `wind_get_global_stock_risk_metrics` | `get_global_stock_risk_metrics` | 风险指标：Beta、Alpha、波动率、Sharpe、VaR |

#### fund_data — 基金/ETF/LOF (10 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_search_funds` | `search_funds` | 全市场基金产品筛选 |
| `wind_get_fund_price_indicators` | `get_fund_price_indicators` | 最新行情快照（净值、IOPV、贴水率） |
| `wind_get_fund_kline` | `get_fund_kline` | 历史K线 |
| `wind_get_fund_quote` | `get_fund_quote` | 日内分钟行情 |
| `wind_get_fund_info` | `get_fund_info` | 基金档案、费率、经理、风格、业绩基准 |
| `wind_get_fund_financials` | `get_fund_financials` | 财务数据：利润、净值、收入、费用、分红 |
| `wind_get_fund_holdings` | `get_fund_holdings` | 重仓股、资产配置、行业配置 |
| `wind_get_fund_performance` | `get_fund_performance` | 业绩、排名、ETF/二级交易表现 |
| `wind_get_fund_holders` | `get_fund_holders` | 持有人结构、申赎情况、规模变动 |
| `wind_get_fund_company_info` | `get_fund_company_info` | 基金管理公司档案、经理团队 |

#### index_data — 指数/板块 (6 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_get_index_price_indicators` | `get_index_price_indicators` | 最新行情快照（涨跌家数、成分股贡献点数） |
| `wind_get_index_kline` | `get_index_kline` | 历史K线 |
| `wind_get_index_quote` | `get_index_quote` | 日内分钟行情 |
| `wind_get_index_basicinfo` | `get_index_basicinfo` | 指数档案：发布机构、基日、基点、成份数量 |
| `wind_get_index_fundamentals` | `get_index_fundamentals` | 基本面：PE/PB/PS、营收、利润、历史分位 |
| `wind_get_index_technicals` | `get_index_technicals` | 技术指标：多周期涨跌幅、MACD、RSI |

#### bond_data — 债券 (4 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_get_bond_basicinfo` | `get_bond_basicinfo` | 债券档案：发行规模、票面利率、期限、兑付 |
| `wind_get_bond_issuer_info` | `get_bond_issuer_info` | 发债主体信息：名称、注册地、行业、股权结构 |
| `wind_get_bond_market_data` | `get_bond_market_data` | 市场数据：报价、估价、溢价、久期、凸性、利差 |
| `wind_get_bond_financial_data` | `get_bond_financial_data` | 发债主体财务：营收、利润、资产、负债 |

#### financial_docs — 公告/新闻 (2 tools)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_get_company_announcements` | `get_company_announcements` | 公司官方公告：年报、季报、招股书等 |
| `wind_get_financial_news` | `get_financial_news` | 第三方财经新闻、市场报道、政策动态 |

#### economic_data — 宏观/行业 (1 tool)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_get_economic_data` | `get_economic_data` | 宏观或行业EDB指标数据（支持频率/量级/币种筛选） |

#### analytics_data — 通用取数兜底 (1 tool)

| MCP 工具名 | server-side tool_name | 功能 |
|-----------|----------------------|------|
| `wind_get_financial_data` | `get_financial_data` | 通用结构化取数兜底，在其他专项工具无法覆盖时使用 |

### 数据源优先级（更新后）

1. **Wind** (Tier-0) — 全市场最全面金融数据，44 工具覆盖 8 大服务域（A股/港美股/基金/指数/债券/公告/宏观/分析）
2. **iFind** (Tier-1) — 精确财务、宏观、债券、港美股、ESG
3. **AkShare** (Tier-2) — 免费备选，基础行情/财报/行业/指数
4. **china-news** (Tier-3) — 免费新闻和公告

### 任务清单

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 创建 Wind MCP Server | `mcp-servers/wind-mcp/server.py` | ✅ 完成 |
| 2 | 创建 Wind MCP requirements | `mcp-servers/wind-mcp/requirements.txt` | ✅ 完成 |
| 3 | 创建 Wind MCP config 模板 | `mcp-servers/wind-mcp/mcp_config.json` | ✅ 完成 |
| 4 | 更新 6 个 .mcp.json | `vertical-plugins/*/.mcp.json` | ✅ 完成 |
| 5 | 更新 4 个 agent .md | `agent-plugins/*/agents/*.md` | ✅ 完成 |
| 6 | 更新 4 个 agent.yaml | `managed-agent-cookbooks/*/agent.yaml` | ✅ 完成 |
| 7 | 更新 CLAUDE.md | `CLAUDE.md` | ✅ 完成 |
| 8 | 更新 check-china.py | `scripts/check-china.py` | ✅ 完成 |
| 9 | 更新 README.md | `README.md` | ✅ 完成 |
| 10 | 更新 SKILL.md 文件 | `vertical-plugins/*/skills/*/SKILL.md` | ✅ 完成 |
| 11 | ✅ server.py v2.0: 按官方 tool-contracts.md 重新对齐 44 个工具名称、参数结构、服务域划分 | `mcp-servers/wind-mcp/server.py` | ✅ 完成 |
