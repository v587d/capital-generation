---
name: wind-mcp
description: 万得 Wind 金融数据 MCP 技能 — 44 个工具覆盖 A 股/港美股/基金/指数/债券/公告/宏观/分析 8 大服务域
---

# Wind MCP — 万得金融数据技能

## 元数据

| 项目 | 内容 |
|------|------|
| MCP 服务器 | `wind-mcp` |
| 工具总数 | **44** |
| 服务域 | **8** |
| 传输协议 | stdio (本地) / SSE (部署) |
| API 密钥 | `WIND_API_KEY` 环境变量 (以 `ak_` 开头) |
| 密钥申请 | https://aifinmarket.wind.com.cn/#/home |
| 认证方式 | `Authorization: Bearer {key}` |
| 工具前缀 | `wind_*` (MCP 调用: `mcp__wind__*`) |

---

## 8 大服务域

| # | server_type | 工具数 | 覆盖 |
|---|------------|:---:|------|
| 1 | `stock_data` | 10 | A 股：搜索/行情/K线/分钟/档案/财务/股东/事件/技术/风险 |
| 2 | `global_stock_data` | 10 | 港股/美股：搜索/行情/K线/分钟/档案/财务/股东/事件/技术/风险 |
| 3 | `fund_data` | 10 | 基金/ETF/LOF：搜索/行情/K线/分钟/档案/财务/持仓/业绩/持有人/公司 |
| 4 | `index_data` | 6 | 指数/板块：行情/K线/分钟/档案/基本面/技术 |
| 5 | `bond_data` | 4 | 债券：档案/主体/市场数据/主体财务 |
| 6 | `financial_docs` | 2 | 文档：公司公告(年报/季报/招股书)、财经新闻 |
| 7 | `economic_data` | 1 | 宏观/行业 EDB 指标 |
| 8 | `analytics_data` | 1 | 通用结构化取数兜底 |

---

## 调用规则

### 参数门禁
- **日期格式**：必须为 `yyyyMMdd`（含前导零，不含短横线）
- **windcode**：仅接受单个标的字符串，不支持数组或逗号拼接
- **indexes**：字段名必须逐字复制 indicators.md 中的值
- **question**：不含空格（中文自然语言）

### 路由优先
1. 公告/年报/季报/招股书 → `financial_docs.get_company_announcements`
2. 新闻/媒体/快讯/报告 → `financial_docs.get_financial_news`
3. 宏观/行业 EDB 指标 → `economic_data.get_economic_data`
4. A 股选股（无具体股票）→ `stock_data.search_stocks`
5. 港股/美股选股（无具体股票）→ `global_stock_data.search_global_stocks`
6. 基金筛选（无具体基金）→ `fund_data.search_funds`
7. 行情/K 线/分钟线 → 对应市场 kline/quote/price_indicators
8. 财务/股东/事件/技术/风险 → 对应市场 NL 工具
9. 兜底 → `analytics_data.get_financial_data`

---

## 完整工具清单

### stock_data — A 股 (10 tools)

| MCP 工具名 | Wind 工具名 | 类型 | 参数 |
|-----------|------------|------|------|
| `wind_search_stocks` | `search_stocks` | NL 查询 | `question`, `lang` |
| `wind_get_stock_price_indicators` | `get_stock_price_indicators` | 快照 | `windcode`, `indexes` |
| `wind_get_stock_kline` | `get_stock_kline` | K 线 | `windcode`, `begin_date`, `end_date`, `period`, `aftime` |
| `wind_get_stock_quote` | `get_stock_quote` | 分钟 | `windcode`, `begin`, `end` |
| `wind_get_stock_basicinfo` | `get_stock_basicinfo` | NL 查询 | `question`, `lang` |
| `wind_get_stock_fundamentals` | `get_stock_fundamentals` | NL 查询 | `question`, `lang` |
| `wind_get_stock_equity_holders` | `get_stock_equity_holders` | NL 查询 | `question`, `lang` |
| `wind_get_stock_events` | `get_stock_events` | NL 查询 | `question`, `lang` |
| `wind_get_stock_technicals` | `get_stock_technicals` | NL 查询 | `question`, `lang` |
| `wind_get_risk_metrics` | `get_risk_metrics` | NL 查询 | `question`, `lang` |

### global_stock_data — 港股/美股 (10 tools)

| MCP 工具名 | Wind 工具名 | 类型 | 参数 |
|-----------|------------|------|------|
| `wind_search_global_stocks` | `search_global_stocks` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_price_indicators` | `get_global_stock_price_indicators` | 快照 | `windcode`, `indexes` |
| `wind_get_global_stock_kline` | `get_global_stock_kline` | K 线 | `windcode`, `begin_date`, `end_date` |
| `wind_get_global_stock_quote` | `get_global_stock_quote` | 分钟 | `windcode`, `begin`, `end` |
| `wind_get_global_stock_basicinfo` | `get_global_stock_basicinfo` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_fundamentals` | `get_global_stock_fundamentals` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_equity_holders` | `get_global_stock_equity_holders` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_events` | `get_global_stock_events` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_technicals` | `get_global_stock_technicals` | NL 查询 | `question`, `lang` |
| `wind_get_global_stock_risk_metrics` | `get_global_stock_risk_metrics` | NL 查询 | `question`, `lang` |

### fund_data — 基金 (10 tools)

| MCP 工具名 | Wind 工具名 | 类型 |
|-----------|------------|------|
| `wind_search_funds` | `search_funds` | NL 查询 |
| `wind_get_fund_price_indicators` | `get_fund_price_indicators` | 快照 |
| `wind_get_fund_kline` | `get_fund_kline` | K 线 |
| `wind_get_fund_quote` | `get_fund_quote` | 分钟 |
| `wind_get_fund_info` | `get_fund_info` | NL 查询 |
| `wind_get_fund_financials` | `get_fund_financials` | NL 查询 |
| `wind_get_fund_holdings` | `get_fund_holdings` | NL 查询 |
| `wind_get_fund_performance` | `get_fund_performance` | NL 查询 |
| `wind_get_fund_holders` | `get_fund_holders` | NL 查询 |
| `wind_get_fund_company_info` | `get_fund_company_info` | NL 查询 |

### 其余服务域

| 服务域 | MCP 工具名 | Wind 工具名 | 类型 |
|--------|-----------|------------|------|
| index_data | `wind_get_index_price_indicators` | `get_index_price_indicators` | 快照 |
| index_data | `wind_get_index_kline` | `get_index_kline` | K 线 |
| index_data | `wind_get_index_quote` | `get_index_quote` | 分钟 |
| index_data | `wind_get_index_basicinfo` | `get_index_basicinfo` | NL 查询 |
| index_data | `wind_get_index_fundamentals` | `get_index_fundamentals` | NL 查询 |
| index_data | `wind_get_index_technicals` | `get_index_technicals` | NL 查询 |
| bond_data | `wind_get_bond_basicinfo` | `get_bond_basicinfo` | NL 查询 |
| bond_data | `wind_get_bond_issuer_info` | `get_bond_issuer_info` | NL 查询 |
| bond_data | `wind_get_bond_market_data` | `get_bond_market_data` | NL 查询 |
| bond_data | `wind_get_bond_financial_data` | `get_bond_financial_data` | NL 查询 |
| financial_docs | `wind_get_company_announcements` | `get_company_announcements` | NL 查询 |
| financial_docs | `wind_get_financial_news` | `get_financial_news` | NL 查询 |
| economic_data | `wind_get_economic_data` | `get_economic_data` | 结构化 |
| analytics_data | `wind_get_financial_data` | `get_financial_data` | NL 查询 |

---

## 启动命令

```bash
# stdio 模式（Claude Desktop / Claude Code）
python3 mcp-servers/wind-mcp/server.py

# SSE 模式（Managed Agent 部署）
python3 mcp-servers/wind-mcp/server.py --transport sse --port 8003

# 安装依赖
pip install -r mcp-servers/wind-mcp/requirements.txt
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|:--:|------|
| `WIND_API_KEY` | 是 | API 密钥（以 `ak_` 开头） |
| `WIND_CONCURRENCY` | 否 | 并发限制，默认 5 |
| `WIND_SSL_NO_VERIFY` | 否 | 设为 1 跳过 SSL 验证（仅开发环境） |

---

## 版本

- **v2.0.0** (2026-06) — 按官方 tool-contracts.md 完全对齐，44 tools / 8 domains
- **v1.0.0** (2025) — 初始版本
