"""Wind MCP Server — 万得 Wind 金融数据 MCP 代理。

将万得 Wind 远程 MCP 服务封装为本地 FastMCP 服务器。
工具定义严格遵循 Wind 官方 tool-contracts.md (2025-03-26 协议)。

服务域 (8):
  stock_data        — A 股 (10 tools)
  global_stock_data — 港股/美股 (10 tools)
  fund_data         — 基金/ETF/LOF (10 tools)
  index_data        — 指数/板块 (6 tools)
  bond_data         — 债券 (4 tools)
  financial_docs    — 公告/新闻 (2 tools)
  economic_data     — 宏观/行业 EDB (1 tool)
  analytics_data    — 通用取数兜底 (1 tool)
  Total: 44 tools

Usage:
    python server.py                              # stdio (本地)
    python server.py --transport sse --port 8003  # SSE (部署)

Env:
    WIND_API_KEY  — Wind API 密钥（优先于 mcp_config.json）
"""

import argparse
import json
import os
import sys
import ssl
import threading
from pathlib import Path
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    from mcp import FastMCP

server = FastMCP(
    "wind-mcp",
    instructions="万得 Wind 金融数据 — A股/港美股/基金/指数/债券/宏观/研报/分析 (44 tools, 8 domains)",
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_CONFIG_PATH = Path(__file__).parent / "mcp_config.json"


def _load_api_key() -> str:
    key = os.environ.get("WIND_API_KEY", "").strip()
    if key:
        return key
    if _CONFIG_PATH.exists():
        cfg = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
        key = cfg.get("api_key", "").strip()
        if key and key != "your-wind-api-key-here":
            return key
    home_cfg = Path.home() / ".wind-aifinmarket" / "config"
    if home_cfg.exists():
        cfg = json.loads(home_cfg.read_text(encoding="utf-8"))
        key = cfg.get("api_key", "").strip()
        if key:
            return key
    return ""


API_KEY = _load_api_key()
BASE_URL = "https://mcp.wind.com.cn"

_SSL_NO_VERIFY = os.environ.get("WIND_SSL_NO_VERIFY", "").strip() in ("1", "true", "yes")
if _SSL_NO_VERIFY:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    print("WARNING: SSL certificate verification DISABLED (WIND_SSL_NO_VERIFY=1). "
          "This is INSECURE — only use in development.", file=sys.stderr)


class CompatibleSSLAdapter(HTTPAdapter):
    """SSL adapter enforcing TLS 1.2+ with hostname verification enabled."""
    def init_poolmanager(self, *args, **kwargs):
        ctx = create_urllib3_context()
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


_session = requests.Session()
_session.mount("https://", CompatibleSSLAdapter())

# ---- Service domain URL mapping (matches Wind official cli.mjs SERVERS) ----
SERVER_URLS = {
    "stock_data":        f"{BASE_URL}/vserver_stock_data/mcp/",
    "global_stock_data": f"{BASE_URL}/vserver_global_stock_data/mcp/",
    "fund_data":         f"{BASE_URL}/vserver_fund_data/mcp/",
    "index_data":        f"{BASE_URL}/vserver_index_data/mcp/",
    "bond_data":         f"{BASE_URL}/vserver_bond_data/mcp/",
    "financial_docs":    f"{BASE_URL}/vserver_financial_docs/mcp/",
    "economic_data":     f"{BASE_URL}/vserver_economic_data/mcp/",
    "analytics_data":    f"{BASE_URL}/vserver_analytics_data/mcp/",
}

# ---------------------------------------------------------------------------
# Session & rate-limit management
# ---------------------------------------------------------------------------

_req_ids: dict[str, int] = {}
_lock = threading.Lock()

CONCURRENCY_LIMIT = int(os.environ.get("WIND_CONCURRENCY", "5"))
_semaphore = threading.Semaphore(CONCURRENCY_LIMIT)


def _next_id(server_type: str) -> int:
    with _lock:
        _req_ids[server_type] = _req_ids.get(server_type, 0) + 1
        return _req_ids[server_type]


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {API_KEY}",
    }


def _parse_sse(text: str):
    """Parse Wind MCP SSE response — handles \"event: message\\ndata: {...}\\n\\n\" format."""
    import re
    trimmed = text.strip()
    # Plain JSON
    if trimmed.startswith("{"):
        return json.loads(trimmed)
    # SSE: strip "event: message\n", extract data:, remove trailing blank lines
    cleaned = re.sub(r'^event:\s*\w+\s*\n', '', trimmed)
    cleaned = re.sub(r'\n{2,}$', '', cleaned)
    if cleaned.startswith('data: '):
        cleaned = cleaned[6:]
    data_lines = [l for l in cleaned.splitlines() if l.startswith('data: ')]
    if not data_lines:
        return json.loads(cleaned)
    json_str = ''.join(d[6:] for d in data_lines)
    return json.loads(json_str)


def _mcp_call(server_type: str, method: str, params: dict, timeout: int = 60):
    """Make a single JSON-RPC call to Wind MCP via SSE endpoint."""
    _semaphore.acquire()
    try:
        payload = {"jsonrpc": "2.0", "id": _next_id(server_type), "method": method, "params": params}
        resp = _session.post(
            SERVER_URLS[server_type],
            json=payload,
            headers=_headers(),
            verify=not _SSL_NO_VERIFY,
            timeout=timeout,
        )
        resp.raise_for_status()
        # Wind MCP returns UTF-8 SSE, but requests may auto-detect as ISO-8859-1
        resp.encoding = "utf-8"
        body = _parse_sse(resp.text)
        if body.get("error"):
            msg = body["error"].get("message", str(body["error"]))
            return {"error": msg}
        result = body.get("result", body)
        # Handle nested MCP content[0].text (SSE pattern)
        if isinstance(result, dict) and "content" in result:
            inner_text = result["content"][0].get("text", "") if result.get("content") else ""
            if inner_text:
                try:
                    inner = json.loads(inner_text)
                    # Check for tool-level error
                    if isinstance(inner, dict) and inner.get("mcp_tool_error_code", 0) != 0:
                        return {"error": inner.get("mcp_tool_error_msg", str(inner))}
                    return inner
                except (json.JSONDecodeError, TypeError):
                    return {"text": inner_text}
        return result
    finally:
        _semaphore.release()


def _call_wind(server_type: str, tool_name: str, arguments: dict) -> str:
    """Proxy a tool call to the Wind remote MCP and return JSON string."""
    if not API_KEY:
        return json.dumps(
            {"error": "Wind API Key 未配置。请设置 WIND_API_KEY 环境变量或在 mcp_config.json 中配置密钥。"
             "申请地址：https://aifinmarket.wind.com.cn/#/home"},
            ensure_ascii=False,
        )
    if server_type not in SERVER_URLS:
        return json.dumps({"error": f"未知服务类型: {server_type}"}, ensure_ascii=False)

    try:
        # Initialize session (stateless — validates key, returns capabilities)
        _mcp_call(server_type, "initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "wind-mcp-proxy", "version": "2.0.0"},
        }, timeout=30)

        # Execute tool call
        data = _mcp_call(server_type, "tools/call", {
            "name": tool_name,
            "arguments": arguments,
        }, timeout=120)

        if isinstance(data, dict) and "error" in data:
            return json.dumps(data, ensure_ascii=False)
        return json.dumps(data, ensure_ascii=False, default=str)
    except requests.exceptions.Timeout:
        return json.dumps({"error": f"Wind {server_type} 请求超时"}, ensure_ascii=False)
    except requests.exceptions.ConnectionError:
        return json.dumps({"error": f"无法连接 Wind {server_type} 服务，请检查网络"}, ensure_ascii=False)
    except Exception as e:
        print(f"[ERROR] wind-mcp {server_type}/{tool_name}: {e}", file=sys.stderr)
        return json.dumps({"error": f"Wind 请求失败，请检查日志"}, ensure_ascii=False)


# =============================================================================
# Tool definitions — strictly follow Wind official tool-contracts.md
# =============================================================================

# ---------------------------------------------------------------------------
# 1. stock_data — A 股 (10 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_search_stocks(question: str, lang: str = "中文") -> str:
    """全市场 A 股智能选股筛选，返回代码列表。

    Args:
        question: 选股条件，如 "筛选沪深市场市值超500亿且连续5日上涨的股票"（不含空格）
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "search_stocks", {"question": question, "lang": lang})


@server.tool()
def wind_get_stock_price_indicators(windcode: str, indexes: str) -> str:
    """获取 A 股最新行情快照指标（最新价、涨跌幅、换手率等）。

    Args:
        windcode: 单个股票代码，如 "600519.SH"
        indexes: 指标字段列表，逗号分隔，从 Wind indicators 词典逐字复制，如 "中文简称,最新成交价,涨跌幅,成交量"
    """
    return _call_wind("stock_data", "get_stock_price_indicators", {"windcode": windcode, "indexes": indexes})


@server.tool()
def wind_get_stock_kline(
    windcode: str, begin_date: str, end_date: str,
    period: str = "10", aftime: str = "0", count: str = "",
) -> str:
    """获取 A 股历史 K 线数据（日/周/月等）。
    严格日期格式: yyyyMMdd（不含短横线）。

    Args:
        windcode: 单个股票代码，如 "600519.SH"
        begin_date: 起始日期，如 "20260401"
        end_date: 结束日期，如 "20260430"
        period: K 线周期（"10"=日K, "11"=周K, "12"=月K），默认 "10"
        aftime: 复权方式（"0"=前复权, "1"=后复权, "2"=不复权），默认 "0"
        count: 返回条数（可选，与日期范围二选一）
    """
    args = {"windcode": windcode, "begin_date": begin_date, "end_date": end_date, "period": period, "aftime": aftime}
    if count:
        args["count"] = count
    return _call_wind("stock_data", "get_stock_kline", args)


@server.tool()
def wind_get_stock_quote(windcode: str, begin: str = "LAST", end: str = "LAST") -> str:
    """获取 A 股日内分钟行情数据。

    Args:
        windcode: 单个股票代码，如 "600519.SH"
        begin: 起始时间点，默认 "LAST"
        end: 结束时间点，默认 "LAST"
    """
    return _call_wind("stock_data", "get_stock_quote", {"windcode": windcode, "begin": begin, "end": end})


@server.tool()
def wind_get_stock_basicinfo(question: str, lang: str = "中文") -> str:
    """查询 A 股公司档案、主营、行业、IPO、上市板等基本情况。

    Args:
        question: 查询条件，如 "600519.SH公司基本档案"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_stock_basicinfo", {"question": question, "lang": lang})


@server.tool()
def wind_get_stock_fundamentals(question: str, lang: str = "中文") -> str:
    """查询 A 股财务数据：盈利、资产负债、利润、现金流、增长率等。

    Args:
        question: 查询条件，如 "贵州茅台2024年ROE和净利润增速"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_stock_fundamentals", {"question": question, "lang": lang})


@server.tool()
def wind_get_stock_equity_holders(question: str, lang: str = "中文") -> str:
    """查询 A 股股本、流通、前十大股东、实控人、限售情况。

    Args:
        question: 查询条件，如 "贵州茅台前十大股东"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_stock_equity_holders", {"question": question, "lang": lang})


@server.tool()
def wind_get_stock_events(question: str, lang: str = "中文") -> str:
    """查询 A 股重大事件：IPO、增发、配股、并购、ST、分红等。

    Args:
        question: 查询条件，如 "宁德时代2024年增发和并购事件"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_stock_events", {"question": question, "lang": lang})


@server.tool()
def wind_get_stock_technicals(question: str, lang: str = "中文") -> str:
    """查询 A 股技术指标：MACD、KDJ、RSI、BOLL、融资融券、龙虎榜等。

    Args:
        question: 查询条件，如 "贵州茅台近60日MACD走势"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_stock_technicals", {"question": question, "lang": lang})


@server.tool()
def wind_get_risk_metrics(question: str, lang: str = "中文") -> str:
    """查询 A 股风险指标：Beta、Jensen Alpha、波动率、Sharpe、VaR 等。

    Args:
        question: 查询条件，如 "贵州茅台过去1年Beta和波动率"
        lang: 语言，默认 "中文"
    """
    return _call_wind("stock_data", "get_risk_metrics", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# 2. global_stock_data — 港股 / 美股 (10 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_search_global_stocks(question: str, lang: str = "中文") -> str:
    """港股/美股智能选股筛选，返回代码列表。

    Args:
        question: 选股条件，如 "筛选港股中市值超1000亿港元的科技股"
        lang: 语言，默认 "中文"
    """
    return _call_wind("global_stock_data", "search_global_stocks", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_price_indicators(windcode: str, indexes: str) -> str:
    """获取港股/美股最新行情快照指标。

    Args:
        windcode: 单个股票代码，如 "00700.HK" 或 "AAPL.O"
        indexes: 指标字段列表，逗号分隔
    """
    return _call_wind("global_stock_data", "get_global_stock_price_indicators", {"windcode": windcode, "indexes": indexes})


@server.tool()
def wind_get_global_stock_kline(
    windcode: str, begin_date: str, end_date: str,
    period: str = "10", aftime: str = "0",
) -> str:
    """获取港股/美股历史 K 线数据。日期格式: yyyyMMdd。

    Args:
        windcode: 单个股票代码，如 "00700.HK"
        begin_date: 起始日期，如 "20260401"
        end_date: 结束日期，如 "20260430"
        period: K 线周期，默认 "10"
        aftime: 复权方式，默认 "0"
    """
    return _call_wind("global_stock_data", "get_global_stock_kline",
                      {"windcode": windcode, "begin_date": begin_date, "end_date": end_date, "period": period, "aftime": aftime})


@server.tool()
def wind_get_global_stock_quote(windcode: str, begin: str = "LAST", end: str = "LAST") -> str:
    """获取港股/美股日内分钟行情数据。

    Args:
        windcode: 单个股票代码
        begin: 起始时间点
        end: 结束时间点
    """
    return _call_wind("global_stock_data", "get_global_stock_quote", {"windcode": windcode, "begin": begin, "end": end})


@server.tool()
def wind_get_global_stock_basicinfo(question: str, lang: str = "中文") -> str:
    """查询港股/美股公司档案、注册地、经营范围、交易所、行业、指数成份等。

    Args:
        question: 查询条件，如 "AAPL.O公司基本档案"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_basicinfo", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_fundamentals(question: str, lang: str = "中文") -> str:
    """查询港股/美股财务数据：盈利、PE/PB/PS、营收、历史分位等。

    Args:
        question: 查询条件，如 "腾讯(00700.HK)2024年ROE和营收"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_fundamentals", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_equity_holders(question: str, lang: str = "中文") -> str:
    """查询港股/美股股本、主要股东、机构持仓、限售解禁。

    Args:
        question: 查询条件，如 "腾讯(00700.HK)前十大股东"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_equity_holders", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_events(question: str, lang: str = "中文") -> str:
    """查询港股/美股重大事件：IPO、增发、并购、监管、分红等。

    Args:
        question: 查询条件，如 "腾讯(00700.HK)分红历史"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_events", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_technicals(question: str, lang: str = "中文") -> str:
    """查询港股/美股技术指标：多周期涨跌幅、MACD、KDJ、RSI、BOLL。

    Args:
        question: 查询条件，如 "AAPL.O的MACD和RSI"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_technicals", {"question": question, "lang": lang})


@server.tool()
def wind_get_global_stock_risk_metrics(question: str, lang: str = "中文") -> str:
    """查询港股/美股风险指标：Beta、Alpha、波动率、Sharpe、最大回撤、VaR。

    Args:
        question: 查询条件，如 "AAPL.O过去1年Beta和波动率"
        lang: 语言
    """
    return _call_wind("global_stock_data", "get_global_stock_risk_metrics", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# 3. fund_data — 基金 / ETF / LOF (10 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_search_funds(question: str, lang: str = "中文") -> str:
    """全市场基金产品筛选，返回基金代码列表。

    Args:
        question: 选基条件，如 "筛选股票型基金中近一年收益率超20%的产品"
        lang: 语言
    """
    return _call_wind("fund_data", "search_funds", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_price_indicators(windcode: str, indexes: str) -> str:
    """获取基金/ETF/LOF 最新行情快照指标（净值、IOPV、贴水率等）。

    Args:
        windcode: 单个基金代码，如 "588200.SH"
        indexes: 指标字段，如 "中文简称,最新成交价,IOPV,贴水率"
    """
    return _call_wind("fund_data", "get_fund_price_indicators", {"windcode": windcode, "indexes": indexes})


@server.tool()
def wind_get_fund_kline(windcode: str, begin_date: str, end_date: str) -> str:
    """获取基金历史 K 线数据。日期格式: yyyyMMdd。

    Args:
        windcode: 单个基金代码
        begin_date: 起始日期
        end_date: 结束日期
    """
    return _call_wind("fund_data", "get_fund_kline", {"windcode": windcode, "begin_date": begin_date, "end_date": end_date})


@server.tool()
def wind_get_fund_quote(windcode: str, begin: str = "LAST", end: str = "LAST") -> str:
    """获取基金日内分钟行情。

    Args:
        windcode: 单个基金代码
        begin: 起始时间点
        end: 结束时间点
    """
    return _call_wind("fund_data", "get_fund_quote", {"windcode": windcode, "begin": begin, "end": end})


@server.tool()
def wind_get_fund_info(question: str, lang: str = "中文") -> str:
    """查询基金档案、费率、经理、风格、业绩基准。

    Args:
        question: 查询条件，如 "易方达蓝筹精选(005827.OF)基金档案"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_info", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_financials(question: str, lang: str = "中文") -> str:
    """查询基金财务数据：利润、净值、收入、费用、分红。

    Args:
        question: 查询条件，如 "005827.OF2024年净利润和分红"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_financials", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_holdings(question: str, lang: str = "中文") -> str:
    """查询基金重仓股、资产配置、行业配置。

    Args:
        question: 查询条件，如 "005827.OF最新一期重仓股"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_holdings", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_performance(question: str, lang: str = "中文") -> str:
    """查询基金业绩、排名、ETF/二级交易表现。

    Args:
        question: 查询条件，如 "005827.OF近1年业绩排名"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_performance", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_holders(question: str, lang: str = "中文") -> str:
    """查询基金持有人结构、申赎情况、规模变动。

    Args:
        question: 查询条件，如 "005827.OF持有人结构"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_holders", {"question": question, "lang": lang})


@server.tool()
def wind_get_fund_company_info(question: str, lang: str = "中文") -> str:
    """查询基金管理公司档案、经理团队。

    Args:
        question: 查询条件，如 "易方达基金管理公司档案"
        lang: 语言
    """
    return _call_wind("fund_data", "get_fund_company_info", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# 4. index_data — 指数 / 板块 (6 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_get_index_price_indicators(windcode: str, indexes: str) -> str:
    """获取指数最新行情快照指标（涨跌家数、成分股贡献点数等）。

    Args:
        windcode: 单个指数代码
        indexes: 指标字段列表
    """
    return _call_wind("index_data", "get_index_price_indicators", {"windcode": windcode, "indexes": indexes})


@server.tool()
def wind_get_index_kline(windcode: str, begin_date: str, end_date: str) -> str:
    """获取指数历史 K 线数据。日期格式: yyyyMMdd。

    Args:
        windcode: 单个指数代码
        begin_date: 起始日期
        end_date: 结束日期
    """
    return _call_wind("index_data", "get_index_kline", {"windcode": windcode, "begin_date": begin_date, "end_date": end_date})


@server.tool()
def wind_get_index_quote(windcode: str, begin: str = "LAST", end: str = "LAST") -> str:
    """获取指数日内分钟行情。

    Args:
        windcode: 单个指数代码
        begin: 起始时间点
        end: 结束时间点
    """
    return _call_wind("index_data", "get_index_quote", {"windcode": windcode, "begin": begin, "end": end})


@server.tool()
def wind_get_index_basicinfo(question: str, lang: str = "中文") -> str:
    """查询指数档案：发布机构、基日、基点、成份数量。

    Args:
        question: 查询条件，如 "沪深300指数档案"
        lang: 语言
    """
    return _call_wind("index_data", "get_index_basicinfo", {"question": question, "lang": lang})


@server.tool()
def wind_get_index_fundamentals(question: str, lang: str = "中文") -> str:
    """查询指数基本面：PE/PB/PS、营收、利润、现金流、历史分位。

    Args:
        question: 查询条件，如 "沪深300PE/PB历史分位"
        lang: 语言
    """
    return _call_wind("index_data", "get_index_fundamentals", {"question": question, "lang": lang})


@server.tool()
def wind_get_index_technicals(question: str, lang: str = "中文") -> str:
    """查询指数技术指标：多周期涨跌幅、MACD、RSI 等。

    Args:
        question: 查询条件，如 "中证500的MACD和RSI"
        lang: 语言
    """
    return _call_wind("index_data", "get_index_technicals", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# 5. bond_data — 债券 (4 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_get_bond_basicinfo(question: str, lang: str = "中文") -> str:
    """查询债券档案：发行规模、票面利率、期限、兑付等。

    Args:
        question: 查询条件，如 "23广东11债券档案"
        lang: 语言
    """
    return _call_wind("bond_data", "get_bond_basicinfo", {"question": question, "lang": lang})


@server.tool()
def wind_get_bond_issuer_info(question: str, lang: str = "中文") -> str:
    """查询发债主体信息：名称、注册地、行业、股权结构、企业背景。

    Args:
        question: 查询条件
        lang: 语言
    """
    return _call_wind("bond_data", "get_bond_issuer_info", {"question": question, "lang": lang})


@server.tool()
def wind_get_bond_market_data(question: str, lang: str = "中文") -> str:
    """查询债券市场数据：报价、估价、溢价、久期、凸性、利差。

    Args:
        question: 查询条件，如 "华海转债最新估价和利差"
        lang: 语言
    """
    return _call_wind("bond_data", "get_bond_market_data", {"question": question, "lang": lang})


@server.tool()
def wind_get_bond_financial_data(question: str, lang: str = "中文") -> str:
    """查询发债主体财务数据：营收、利润、资产、负债。

    Args:
        question: 查询条件
        lang: 语言
    """
    return _call_wind("bond_data", "get_bond_financial_data", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# 6. financial_docs — 文档 / 公告 (2 tools)
# ---------------------------------------------------------------------------

@server.tool()
def wind_get_company_announcements(query: str, top_k: int = 10) -> str:
    """获取公司官方公告：年报、季报、招股书等。

    Args:
        query: 公告关键词（不含空格），如 "贵州茅台2024年度报告"
        top_k: 返回条数，默认 10
    """
    return _call_wind("financial_docs", "get_company_announcements", {"query": query, "top_k": top_k})


@server.tool()
def wind_get_financial_news(query: str, top_k: int = 10) -> str:
    """获取第三方财经新闻、市场报道、政策动态。

    Args:
        query: 新闻关键词（不含空格），如 "美联储利率政策"
        top_k: 返回条数，默认 10
    """
    return _call_wind("financial_docs", "get_financial_news", {"query": query, "top_k": top_k})


# ---------------------------------------------------------------------------
# 7. economic_data — 宏观 / 行业 (1 tool)
# ---------------------------------------------------------------------------

@server.tool()
def wind_get_economic_data(
    metricIdsStr: str,
    beginDate: str = "",
    endDate: str = "",
    freq: str = "",
    magnitude: str = "",
    currency: str = "",
    searchType: str = "0",
    ifUnion: str = "1",
) -> str:
    """获取宏观或行业 EDB 指标数据。日期格式: yyyyMMdd。

    Args:
        metricIdsStr: 自然语言指标查询，如 "中国CPI同比"
        beginDate: 起始日期，如 "20240101"
        endDate: 结束日期，如 "20261231"
        freq: 频率（1=日, 4=月, 8=年等）
        magnitude: 量级，如 "亿"
        currency: 币种 (USD/CNY)
        searchType: 搜索类型（0=深度, 1=精确），默认 "0"
        ifUnion: 联合查询（1=开启, 2=关闭），默认 "1"
    """
    args = {"metricIdsStr": metricIdsStr, "searchType": searchType, "ifUnion": ifUnion}
    if beginDate:
        args["beginDate"] = beginDate
    if endDate:
        args["endDate"] = endDate
    if freq:
        args["freq"] = freq
    if magnitude:
        args["magnitude"] = magnitude
    if currency:
        args["currency"] = currency
    return _call_wind("economic_data", "get_economic_data", args)


# ---------------------------------------------------------------------------
# 8. analytics_data — 通用取数兜底 (1 tool)
# ---------------------------------------------------------------------------

@server.tool()
def wind_get_financial_data(question: str, lang: str = "CNS") -> str:
    """通用结构化取数兜底工具。在其他专项工具无法覆盖时使用。

    Args:
        question: 自然语言取数需求（不含空格）
        lang: 语言（CNS=中文, ENS=英文），默认 "CNS"
    """
    return _call_wind("analytics_data", "get_financial_data", {"question": question, "lang": lang})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Wind MCP Server v2.0")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
    parser.add_argument("--port", type=int, default=8003)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    if not API_KEY:
        print(
            "WARNING: Wind API Key 未配置。"
            "请设置 WIND_API_KEY 环境变量或在 mcp_config.json 中配置密钥。"
            "申请地址：https://aifinmarket.wind.com.cn/#/home",
            file=sys.stderr,
        )

    if args.transport == "sse":
        if args.host in ("0.0.0.0", "::"):
            print(f"WARNING: SSE server binding to {args.host} — accessible from ANY network. "
                  "Use --host 127.0.0.1 for local-only access or put a reverse proxy in front.",
                  file=sys.stderr)
        print(f"Starting Wind SSE server on http://{args.host}:{args.port}/mcp", file=sys.stderr)
        server.run(transport="sse", host=args.host, port=args.port)
    else:
        print("Starting Wind stdio MCP server (v2.0)...", file=sys.stderr)
        server.run(transport="stdio")


if __name__ == "__main__":
    main()
