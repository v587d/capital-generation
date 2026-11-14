# 美股盘前/盘后报价（U1）：腾讯 `pandata` 落地方案

> 状态：**已实现，待盘前窗口真机复核**（2026-11-14）。
>
> 缺口来自 [`data-capability-gaps-2026-11.md`](data-capability-gaps-2026-11.md) U1：
> `tencent_us_quote` 的快照不透出盘前/盘后，腾讯只在美股 K 线响应的 `pandata` 节点里给延长时段。
> 本文记录“为什么不用 Longbridge SDK”“真报文长什么样”“能力契约与验收”。

---

## 0. 决策

**不接 Longbridge SDK / 不要求任何 Longbridge 账户。** 原因不是 SDK 体积，而是分发边界：

- Longbridge OpenAPI 的行情数据也要求 Longbridge 账户，并完成 OAuth 授权或使用
  App Key / App Secret / Access Token 三件套；实时行情走 WebSocket/TCP + Protobuf，
  不在 REST 上。OAuth 只是免 API Key，不是匿名接口。
- npm 包不能内置 token；每个部署都要各自开 Longbridge 账户、各自授权。对“安装即用”的用户太重。
- 共享一个账户/中心代理属于数据再分发，受 Longbridge Non-Commercial Licence 限制。

因此 U1 用仓库已有的腾讯公开端点，**零账户、零密钥、纯 HTTP**；Longbridge 保留为将来
“愿意开 Longbridge 账户的高级用户”的可选增强，不作为默认源。

---

## 1. 真报文（2026-11-14 14:31 北京时间，AAPL）

请求：

```text
GET https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL.OQ,day,,,10,qfq
```

响应中的 `data["usAAPL.OQ"]` 同时带 `qt`（正规时段快照）与 `pandata`（延长时段）：

```json
{
  "pandata": {
    "last": "355.40",
    "volume": "40027467",
    "pct": "-0.24",
    "netchange": "-0.87",
    "time": "2026-11-13 20:15:00",
    "tag": "after",
    "season": "EST"
  }
}
```

`qt` 里对应字段：

| 位置 | 字段 | AAPL 实测 |
|---|---|---|
| 0 | 延迟标记 | `delay` |
| 1 | 中文名 | 苹果 |
| 2 | 带交易所后缀的代码 | `AAPL.OQ` |
| 3 | 正规时段最后价 | `356.27` |
| 4 | 正规时段昨收 | `354.88` |
| 30 | 正规时段最后成交时间（美东） | `2026-11-13 16:00:01` |
| 35 | 币种 | `USD` |

关键推论：`pandata.netchange = last − 正规收盘`（355.40 − 356.27 = −0.87），
所以 **`prev_close` 必须用 `last − netchange` 反推**，不能拿 `qt[4]`（昨收 354.88）当盘后涨跌基准。
盘前时这个基准通常就是昨收；盘后时是当日正规收盘。两者分列，避免把“盘后涨跌”写成“相对昨收”。

---

## 2. 能力契约

`tencent_us_prepost_quote`（topic `quote`，source `tencent`）

**输入**

```text
codes: string[]   # 1..20，美股/ETF/ADR，如 AAPL、BRK.B、BABA.N
```

**输出（一行一只，不按 session 拆行）**

| 字段 | 说明 |
|---|---|
| `code` | 上游带交易所后缀的身份（AAPL.OQ） |
| `tencent_symbol` | 解析后的腾讯符号（usAAPL.OQ） |
| `name` / `currency` | 上游原文 |
| `session` | `pre` / `after`；没有延长时段为 null |
| `price` | 延长时段最后成交；没有为 null |
| `prev_close` | **涨跌基准** = `last − netchange`；不是昨收 |
| `change_amt` / `change_pct` | `netchange` / `pct`；`pct` 是百分数原值（−0.24 = −0.24%） |
| `volume_shares` | 延长时段成交量（股） |
| `session_time` | 延长时段最后成交时间（美东墙钟） |
| `session_time_zone` | 上游 `season` 原值（EST/EDT），只作展示 |
| `exchange_time_zone` | 固定 `America/New_York` |
| `quote_time_utc` | 由美东墙钟换算的 UTC ISO；用 `Intl` 处理 DST，不信 `season` |
| `regular_price` / `regular_prev_close` / `regular_quote_time` | 正规时段对照值 |
| `delay` | 腾讯快照第 0 位是否为 `delay`；公开源不承诺实时 |
| `available` | 是否有延长成交；false 时 `price=null`，不补 0 |
| `reason` | `no_extended_session` / `empty_extended_price` / `ticker_not_found` / null |
| `source` | `tencent` |

**行为规则**

- 只保留上游**最近一段**延长时段；不承诺同时给盘前和盘后。
- 没有 `pandata`（例如盘中、或该标的不支持延长时段）：返回 `available=false`，
  不拿 `regular_price` 冒充。
- `tag` 只接受实测过的 `pre` / `after`；出现其他值（例如 `overnight`）**响亮失败**，
  不静默贴错标签。
- 未知 ticker 返回单行 `available=false` + `reason=ticker_not_found`，不静默丢行；
  网络/形状错误仍整批失败。
- 单只股票先由快照解析交易所后缀，再打 K 线；`AAPL` 与 `AAPL.OQ` 归一成同一只。
- 一次最多 20 只；每只两次上游请求（快照解析 + K 线），走进程级 120ms 节流链。

---

## 3. 验收

已通过：

- `test/tencent-source.test.mjs`：真实 post 形状 + 合成 pre 形状、`prev_close` 反推、
  UTC 换算、无 `pandata`、未知 ticker、未知 tag、坏时间、20 只上限。
- 真机 2026-11-14：`AAPL` / `TSLA` 返回 `session=after`、`price=355.40/387.16`、
  `prev_close=356.27/390.22`、`quote_time_utc=2026-11-14T01:15:00.000Z`。
- `npm run docs:capabilities`：能力表 132 条；九主题分片仍通过。

**待盘前窗口复核**：当前真机样本只有 `after`。`pre` 分支目前由合成 fixture 覆盖；
下一个美股盘前窗口（北京时间 17:00–21:30 左右）应再跑一次 AAPL，确认 `tag=pre` 与
`prev_close` 基准，再把它写进最终验收记录。

**不能承诺**：

- 没有 high/low；没有 overnight（未实测）；
- 延长时段只有一个快照，不是逐笔序列；
- 腾讯公开端点无 SLA，字段/节点可能变；形状断言与测试会先红；
- 免费公开源可能延迟，`delay` 必须原样带出，不标“实时”。

---

## 4. 与 Longbridge 的取舍

| 维度 | 腾讯 `pandata` | Longbridge |
|---|---|---|
| 账户与鉴权 | 无 | 需要 Longbridge 账户；OAuth 或 App Key/Secret/Access Token 三件套 |
| 依赖 | 纯 HTTP | 官方 SDK 是原生 N-API（约 33 MB/平台）；行情也可自写 WebSocket |
| 盘前/盘后 | 最近一段；字段较少 | 同一条 quote 同时给 pre/post/overnight，字段完整 |
| 历史/基本面/日历 | 只有行情 | 有 K 线、一致预期、评级、日历等 |
| 分发 | 安装即用 | 每个部署各自授权 |

结论：**U1 用腾讯，满足零账户分发；Longbridge 只在将来做可选增强，不进入默认安装。**
