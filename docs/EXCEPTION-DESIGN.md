# 异常与错误消息统一设计

> v0.4.0 基础设施 | 2026-08-17 | 承接 `docs/DEGRADATION.md` §LLM-first 错误消息规范

## 1. 背景与目标

### 1.1 问题

当前 MCP 工具层的错误处理存在三个结构性问题：

| 问题 | 现状 | 影响 |
|---|---|---|
| **错误消息格式不统一** | `ParamError` / `AuthError` 等直接 raise，FastMCP 捕获后包装为 `ToolError("Error executing tool xxx: <原始消息>")` | LLM 收到的是原始异常字符串，格式不可预测 |
| **三要素缺失** | `DEGRADATION.md` 定义了"发生了什么/为什么/下一步"三要素规范，但大部分 `ParamError` 消息只描述了"发生了什么"，缺少"为什么"和"下一步" | LLM 无法自主纠偏，只能反复重试或放弃 |
| **非错误引导无统一结构** | 歧义消歧 (`render_ambiguity`)、未找到 (`render_not_found`)、资产类型不符等走"正常返回 + warnings"路径，与错误路径格式割裂 | LLM 难以区分"数据为空"和"参数有误" |

### 1.2 目标

1. **统一错误响应格式**：所有 MCP 工具的错误返回均采用一致的 JSON 结构
2. **强制三要素**：每条错误消息必须包含"发生了什么 / 为什么 / 下一步"
3. **消除原始异常透传**：禁止 FastMCP 的 `ToolError` 包装直接到达 LLM
4. **非错误引导标准化**：歧义、未找到、资产类型不符等走统一的 `guide` 响应格式

## 2. 当前错误流

```
adapter (THS/Wind/AKShare)
  └─ raise FinError subclass (ParamError/AuthError/...)
       │
       ▼
router (core/domain/routing.py)
  └─ 根据 kind 决策: 重试/换源/门控/直接返回
  └─ 非 Retryable 的 FinError 直接 re-raise
       │
       ▼
tool function (servers/mcp_data.py)
  └─ 部分工具内部 raise ParamError (参数校验)
  └─ 无 try/except，异常直接传播
       │
       ▼
FastMCP Tool.run()
  └─ except Exception → ToolError("Error executing tool {name}: {e}")
       │
       ▼
MCP 协议层
  └─ JSON-RPC error response
       │
       ▼
LLM 收到: "Error executing tool fin_data__get_financials: statement 必须是..."
```

**断裂点**：从 `FinError` 到 `ToolError` 的转换丢失了结构化信息（kind/retryable/source 等），LLM 只看到字符串。

## 3. 统一错误响应格式

### 3.1 错误响应（`isError=true` 路径）

MCP 工具函数**不再直接 raise 异常**，而是返回错误 dict。FastMCP 以 `isError=false` 透传（正常 JSON），LLM 通过 `isError` 字段判断。

```json
{
  "isError": true,
  "error": {
    "kind": "PARAM",
    "message": "statement 参数值 'xxx' 不合法，仅支持 income/balance/cashflow/indicators",
    "reason": "参数校验失败：工具只接受四种 statement 类型",
    "action": "请使用 statement='income' 或 'balance' 或 'cashflow' 或 'indicators' 重新调用",
    "source": "同花顺",
    "vendor": "ths",
    "endpoint": "/api/a-share/financials/*",
    "code": 1001,
    "request_id": "r-abc123"
  }
}
```

**字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | string | ✅ | 错误分类：`AUTH` / `PARAM` / `RATE_LIMIT` / `TIMEOUT` / `NO_DATA` / `SOURCE_DOWN` / `QUOTA` / `INTERNAL` |
| `message` | string | ✅ | **发生了什么**：简洁描述错误事实，含关键参数值 |
| `reason` | string | ✅ | **为什么**：归类说明（与 `kind` 对应），帮助 LLM 理解根因 |
| `action` | string | ✅ | **下一步**：LLM 可直接执行的动作（改参数/换标的/等多久/检查配置） |
| `source` | string | ❌ | 数据源规范名（同花顺/Wind/AKShare） |
| `vendor` | string | ❌ | 内部 vendor id |
| `endpoint` | string | ❌ | 触发错误的端点 |
| `code` | int\|string | ❌ | vendor 原始错误码 |
| `request_id` | string | ❌ | vendor 请求追踪 ID |

### 3.2 引导响应（非错误路径）

歧义消歧、未找到、资产类型不符等场景，返回统一引导格式：

```json
{
  "data": null,
  "guide": {
    "kind": "AMBIGUITY",
    "message": "'000001' 有歧义：匹配到 2 个标的",
    "reason": "代码 '000001' 在 A 股和指数中均存在",
    "action": "请先调用 fin_data__search_symbols(query='000001') 消歧，或用 market 参数限定",
    "candidates": [
      {"symbol": "000001.SZ", "name": "平安银行", "asset_type": "a-share"},
      {"symbol": "000001.SH", "name": "上证指数", "asset_type": "a-share-index"}
    ]
  },
  "source": "",
  "tier": "",
  "ts": "2026-08-17T12:00:00Z",
  "warnings": []
}
```

**引导 `kind` 枚举**：

| kind | 场景 | 示例 action |
|---|---|---|
| `AMBIGUITY` | 代码/名称歧义 | "调用 search_symbols 消歧" |
| `NOT_FOUND` | 本地代码表未命中 | "调用 search_symbols 查询确认" |
| `ASSET_GATE` | 资产类型与工具不匹配 | "该工具仅支持 {类型}，请使用对应工具" |
| `DEGRADATION` | 全链降级后返回空结果 | "所有数据源均不可用，返回空结果" |
| `CAPABILITY` | 源不支持该能力 | "当前数据源不支持此查询" |

### 3.3 成功响应（不变）

保持现有 `render_envelope` 格式，`isError` 缺省为 `false`。

## 4. 错误消息三要素规范

### 4.1 三要素定义

每条 `message` / `reason` / `action` 必须遵循：

| 要素 | 字段 | 要求 | 禁止 |
|---|---|---|---|
| **发生了什么** | `message` | vendor + endpoint + code/类型 + 关键参数值 | 禁止原文透传（如 `"Invalid or revoked API key"`） |
| **为什么** | `reason` | 归类到 `kind`，一句话说明根因 | 禁止模糊描述（如 `"出错了"`） |
| **下一步** | `action` | LLM 可直接执行：等多久/改什么/换什么/检查什么 | 禁止空 action；禁止人话（如 `"请联系客服"`） |

### 4.2 各 kind 消息模板

#### AUTH（权限/认证）

```
message: "同花顺 API Key 认证失败 (2003): {endpoint} 返回拒绝"
reason: "API Key 无效、已过期、或被临时限流（2003 可能是临时限流而非 key 失效）"
action: "请先等待 30 秒后重试；若持续失败，检查 ~/.dsh/.credentials.yaml 中的 ths_api_key 是否正确"
```

#### PARAM（参数校验）

```
message: "{工具名} 参数 '{参数名}' 值 '{值}' 不合法: {具体原因}"
reason: "参数校验失败: {约束说明}"
action: "请使用 {正确值示例} 重新调用"
```

#### RATE_LIMIT（限流）

```
message: "同花顺限流 (4001): {endpoint} 触发 QPS 限制"
reason: "请求频率超过同花顺免费 API 限制"
action: "请等待 2 秒后重试；批量查询建议减少 symbols 数量（当前 {N} 只）"
```

#### QUOTA（配额耗尽）

``
message: "Wind 积分耗尽: {具体原因}"
reason: "Wind 每日免费积分为 1000（有效期 1 天），当前已用完"
action: "Wind 配额将在次日自动恢复；同花顺免费接口仍可用（部分功能降级）"
```

#### NO_DATA（无数据）

```
message: "{标的} 在 {日期} 无 {数据类型} 数据"
reason: "标的不存在 (3001) / 数据尚未发布 (3002) / 非交易日无行情"
action: "若为 3002（数据尚未准备），请稍后重试；若为 3001（标的不存在），请用 search_symbols 确认代码"
```

#### TIMEOUT（超时）

```
message: "{源} {endpoint} 请求超时 ({N}s)"
reason: "上游服务响应超时，可能是网络波动或服务端负载"
action: "请等待 5 秒后重试；若持续超时，可尝试切换数据源（当前链: {chain}）"
```

#### SOURCE_DOWN（服务不可用）

```
message: "{源} {endpoint} 服务异常 (HTTP {status})"
reason: "上游服务端错误，非客户端可修复"
action: "请等待 10 秒后重试；降级链会自动尝试下一个数据源"
```

#### INTERNAL（内部错误）

```
message: "{源} 返回了意外的响应格式: {简要描述}"
reason: "可能是 API 契约变更或适配器解析逻辑缺陷"
action: "请将此错误报告给维护者；可尝试用其他工具获取同类数据"
```

## 5. MCP 层渲染设计

### 5.1 渲染入口

在 `servers/mcp_data.py` 新增 `render_error()` 函数，作为所有 MCP 工具的统一错误渲染入口：

```python
def render_error(e: FinError) -> dict[str, Any]:
    """FinError → MCP 统一错误响应 (EXCEPTION-DESIGN.md §3.1)."""
    return {
        "isError": True,
        "error": {
            "kind": e.kind,
            "message": _format_message(e),
            "reason": _format_reason(e),
            "action": _format_action(e),
            **_extra_fields(e),
        },
    }
```

### 5.2 消息格式化器

每种 `FinError` 子类对应一个 `_format_*` 函数：

| FinError 子类 | `_format_message` | `_format_reason` | `_format_action` |
|---|---|---|---|
| `AuthError` | 含 vendor + code | 归类为权限/认证 | 建议等重试或检查 key |
| `ParamError` | 含参数名 + 值 + 约束 | 归类为参数校验 | 给出正确值示例 |
| `RateLimitError` | 含 endpoint + code | 归类为限流 | 建议等待时间 |
| `FinTimeoutError` | 含 endpoint + 超时秒数 | 归类为超时 | 建议重试或切换源 |
| `NoDataError` | 含标的 + 日期 + 数据类型 | 归类为无数据 | 区分 3001/3002 给不同 action |
| `SourceDownError` | 含 HTTP status | 归类为服务不可用 | 建议等待或降级 |
| `QuotaError` | 含 vendor + 配额信息 | 归类为配额耗尽 | 建议等待恢复或切换源 |
| `InternalError` | 含异常类型 + 简要描述 | 归类为内部错误 | 建议报告维护者 |

### 5.3 工具函数改造模式

**改造前**（当前）：
```python
async def tool_get_financials(...):
    if statement not in ("income", "balance", "cashflow", "indicators"):
        raise ParamError(f"statement 必须是 ..., 收到 {statement!r}")
    # ...
```

**改造后**：
```python
async def tool_get_financials(...):
    try:
        if statement not in ("income", "balance", "cashflow", "indicators"):
            raise ParamError(
                f"statement 参数值 {statement!r} 不合法",
                reason="fin_data__get_financials 仅支持 income/balance/cashflow/indicators",
                action=f"请使用 statement='income' 重新调用",
            )
        # ...
    except FinError as e:
        return render_error(e)
```

### 5.4 适配器层改造

适配器层（`core/adapters/`）的 `FinError` 消息也需要同步改造，遵循三要素：

**改造前**：
```python
raise AuthError(
    "同花顺 API Key 无效或未认证 (401/403)",
    source=..., vendor=..., endpoint=..., status=resp.status_code,
)
```

**改造后**：
```python
raise AuthError(
    "同花顺 API Key 认证失败 (HTTP {status_code})",
    source=..., vendor=..., endpoint=..., status=resp.status_code,
    reason="API Key 无效、已过期、或被临时限流",
    action="请等待 30 秒后重试；若持续失败，检查 ~/.dsh/.credentials.yaml 中的 ths_api_key",
)
```

> **注意**：`FinError` 基类目前不支持 `reason` / `action` 字段。需要在 `FinError.__init__` 中新增可选 `reason` / `action` 参数，或在 `render_error()` 中通过 `kind` 查表获取。推荐后者（不改 domain 层，配置外置）。

### 5.5 配置外置方案

在 `config/error_messages.yaml` 中定义每个 `kind` + `vendor` + `code` 的三要素模板：

```yaml
# config/error_messages.yaml — 错误消息模板 (EXCEPTION-DESIGN.md)
# 渲染层查表: kind → vendor → code → {message_tpl, reason, action}

defaults:
  AUTH:
    reason: "API Key 认证失败: 无效、已过期、或被临时限流"
    action: "请等待 30 秒后重试；若持续失败，检查 ~/.dsh/.credentials.yaml 中的 API Key"
  PARAM:
    reason: "参数校验失败"
    action: "请检查参数值是否符合工具描述中的约束"
  RATE_LIMIT:
    reason: "请求频率超过数据源限制"
    action: "请等待 2 秒后重试"
  NO_DATA:
    reason: "未找到数据: 标的不存在或数据尚未发布"
    action: "若为数据尚未发布，请稍后重试；若标的不存在，请用 search_symbols 确认"
  TIMEOUT:
    reason: "上游服务响应超时"
    action: "请等待 5 秒后重试"
  SOURCE_DOWN:
    reason: "上游服务不可用"
    action: "请等待 10 秒后重试；降级链会自动尝试下一个数据源"
  QUOTA:
    reason: "数据源配额耗尽"
    action: "配额将在次日自动恢复；可尝试使用其他数据源"
  INTERNAL:
    reason: "内部错误: 可能是 API 契约变更"
    action: "请将此错误报告给维护者"

ths:
  2003:
    message: "同花顺临时拒绝 (2003): 可能是高频请求触发限流"
    reason: "2003 可能是临时限流而非 key 失效（实测确认，见 LESSONS §6.5）"
    action: "请等待 30 秒后重试；若持续出现再检查 key"
  1001:
    message: "同花顺缺少必填参数: {endpoint}"
    reason: "请求缺少必填查询参数"
    action: "请检查工具参数是否完整"
  4001:
    message: "同花顺限流 (4001): {endpoint} 触发 QPS 限制"
    reason: "请求频率超过免费 API 限制"
    action: "请等待 2 秒后重试；批量查询建议减少数量"

wind:
  AUTH_ERROR:
    message: "Wind API Key 认证失败"
  DAILY_LIMIT_ERROR:
    message: "Wind 每日请求次数超限"
    action: "Wind 配额将在次日自动恢复；同花顺免费接口仍可用"
  BALANCE_ERROR:
    message: "Wind 积分余额不足"
    action: "Wind 配额将在次日自动恢复；同花顺免费接口仍可用"
```

### 5.6 渲染层改造流程

```
tool function
  └─ try/except FinError as e:
       └─ return render_error(e)
            │
            ▼
  render_error(e)
    └─ 查 config/error_messages.yaml (kind → vendor → code)
    └─ 填充 message/reason/action (模板 + 实际值)
    └─ 返回 {"isError": True, "error": {...}}
       │
       ▼
  FastMCP Tool.run()
    └─ 返回值是 dict → convert_result → 正常 JSON 响应
    └─ isError=True → LLM 看到结构化错误
```

**关键点**：工具函数返回 dict 而非 raise 异常，FastMCP 不会触发 `ToolError` 包装。LLM 收到的是结构化 JSON，而非原始字符串。

## 6. 非错误引导改造

### 6.1 现有引导路径

| 场景 | 当前实现 | 输出格式 |
|---|---|---|
| 代码歧义 | `render_ambiguity()` | `{data: null, warnings: [...], ambiguous: [...]}` |
| 代码未找到 | `render_not_found()` | `{data: null, warnings: [...]}` |
| 资产类型不符 | `_not_asset_response()` | `{data: null, warnings: [...]}` |
| 全链降级空结果 | routing 返回空 Envelope | `{data: [], warnings: [...]}` |

### 6.2 统一引导格式

所有非错误引导统一为：

```json
{
  "data": null,
  "guide": {
    "kind": "AMBIGUITY | NOT_FOUND | ASSET_GATE | DEGRADATION | CAPABILITY",
    "message": "发生了什么",
    "reason": "为什么",
    "action": "下一步"
  },
  "source": "",
  "tier": "",
  "ts": "...",
  "warnings": []
}
```

`guide` 字段的存在让 LLM 可以区分：
- `data` 非空 → 正常数据
- `guide` 存在 → 需要执行 action
- `isError` 存在 → 错误，需要处理

## 7. 渲染层改造清单

| 改造项 | 文件 | 说明 |
|---|---|---|
| 新增 `render_error()` | `servers/mcp_data.py` | 统一错误渲染入口 |
| 新增 `_format_*` 函数 | `servers/mcp_data.py` | 每种 FinError 子类的消息格式化 |
| 新增 `config/error_messages.yaml` | `config/` | 错误消息模板（三要素） |
| 改造 `render_ambiguity()` | `servers/mcp_data.py` | 输出含 `guide` 字段 |
| 改造 `render_not_found()` | `servers/mcp_data.py` | 输出含 `guide` 字段 |
| 改造 `_not_asset_response()` | `servers/mcp_data.py` | 输出含 `guide` 字段 |
| 改造工具函数 | `servers/mcp_data.py` | 所有 `raise ParamError` → `try/except` + `render_error()` |
| 改造适配器消息 | `core/adapters/ths.py` 等 | FinError 消息遵循三要素 |
| 加载 error_messages.yaml | `core/config.py` | 新增配置加载 |

## 8. 测试策略

### 8.1 单元测试

| 测试类型 | 覆盖范围 | 验证点 |
|---|---|---|
| `render_error` 格式 | 每种 FinError 子类 | 输出含 `isError` + `kind` + `message` + `reason` + `action` |
| 三要素完整性 | 所有 `raise ParamError` 路径 | `action` 非空；`reason` 非空 |
| 模板查表 | `error_messages.yaml` | THS 2003 特殊处理；默认模板覆盖所有 kind |
| 引导格式 | `render_ambiguity` / `render_not_found` | 输出含 `guide` 字段 |
| 工具函数改造 | 所有 `fin_data__*` 工具 | 不再 raise 异常，返回 dict |

### 8.2 集成测试

| 测试 | 场景 | 验证点 |
|---|---|---|
| FastMCP 透传 | 工具函数返回 `render_error()` 结果 | LLM 收到 JSON 含 `isError: true` + 三要素 |
| 降级链错误 | THS AUTH → 跳过 → Wind → 成功 | warnings 含 THS 错误三要素 |
| 全链失败 | 所有源失败 | 返回最后错误的三要素 |

### 8.3 契约测试

| 测试 | 说明 |
|---|---|
| 三要素完整性扫描 | 遍历所有 `raise ParamError` / `FinError` 路径，断言 `reason` 和 `action` 非空 |
| error_messages.yaml 覆盖率 | 断言每个 FinError 子类的 `kind` 都有默认模板 |
| 无原始异常透传 | 扫描 MCP 工具函数，断言无裸 `raise`（全部走 `render_error`） |

## 9. 与现有规范的关系

| 文档 | 关系 |
|---|---|
| `docs/DEGRADATION.md` §LLM-first | 本文档是该规范的**实现细化**：三要素从要求变为代码结构 |
| `docs/DESIGN_REVIEW.md` 决策 9 | 工具名/schema 冻结纪律不变；错误响应格式是**输出格式**变更，不影响 schema |
| `docs/DESIGN_REVIEW.md` 决策 14 | 上下文优化纪律不变；错误 JSON 比原始异常字符串更紧凑 |
| `config/error_map.yaml` | 保持不变：错误码→kind 映射不变；本文档在此基础上加消息模板 |
| `docs/LESSONS.md` §6.5 | THS 2003 特殊处理逻辑迁入 `config/error_messages.yaml` |

## 10. 迁移计划

### Phase 1：基础设施（M0）
- 新增 `config/error_messages.yaml`
- 新增 `render_error()` + `_format_*` 函数
- 加载 `error_messages.yaml`

### Phase 2：工具函数改造（M1）
- 所有 `fin_data__*` 工具函数：`raise ParamError` → `try/except` + `render_error()`
- 非错误引导：`render_ambiguity` / `render_not_found` / `_not_asset_response` 加 `guide` 字段

### Phase 3：适配器消息改造（M2）
- `core/adapters/ths.py`：FinError 消息遵循三要素
- `core/adapters/wind.py`：同上
- `core/adapters/akshare_adapter.py`：同上

### Phase 4：测试与验收（M3）
- 三要素完整性扫描测试
- `error_messages.yaml` 覆盖率测试
- 全链集成测试
