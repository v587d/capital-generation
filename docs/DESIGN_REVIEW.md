# 设计评审:已达成决策与理由

> 2026-08-14 | 对 `dsh金融数据插件设计.md` 的架构评审结论。**改动这些决策前先讨论** —— 它们是避免反复 refactor 的依据。

## 背景:五点共识与三点修正

原共识:三源互备 / BYOK 或平台 Key / 适配层找均衡点 / 远期是金融专家 Agent 体系 / 结构一次到位。
评审修正:**对账前提不成立**(复权价跨源不可比)、**适配均衡点未定义**(现定为 L1+L2 做死、L3 只标注)、**结构需按"数据平台 → Agent 体系"两级定位**。

## 已达成决策(决策 → 理由)

1. **对账只限未复权数据 + 免费源间(THS×AKShare);Wind 只作基准,不参与对账**
   复权价是算法产物,THS 与东财口径不同,对账必误报;对 Wind 对账 = 双倍积分。
2. **AKShare 兜底纪律:单标的/小批量 + 频率闸,禁止全市场拉取过滤**
   全市场快照很重,并发触发封 IP,免费兜底源不能最先挂。
3. **禁止静默降级:结果必带 `source` + `degraded`,降级可观测**
   否则掩盖爬虫数据质量问题和需要人工处理的故障(账单/配额/接口变更)。
4. **错误分类先行,判定表外置**:AUTH/QUOTA 立即返回;RATE_LIMIT/TIMEOUT 才在链内重试(详见 `docs/DEGRADATION.md`)
   不分类 = 模型拿到 "all sources failed" 盲目重试 = 浪费请求次数。
5. **symbol 映射以 THS ticker-list 为权威源,定期同步;裸代码推断只做兜底**
   可转债/指数/基金同一串数字在不同类别下市场不同,裸推断必出错。
6. **适配均衡点 = L1 标识 + L2 语义做死,L3 口径只标注**(详见 `docs/DATA_MODEL.md`)
   太深无异于不适配;太浅则字段/单位错误且不可见。
7. **三源平权 → "主干 + 按域备用"**(详见 `docs/DEGRADATION.md` §主干表)
   三源同时全量维护成本线性叠加,收益递减。
8. **结构两级定位:`core/` 零协议依赖(不 import mcp/dsh)→ `servers/` MCP 薄壳 → `agents/` 未来编排**
   数据核心库是纯 Python 库,上层都是消费者;未来加 agent 层数据层零改动。
9. **工具面从第一天分命名空间:`fin_data__*`(精确数据)/ `fin_agent__*`(未来编排入口)**
   宿主只挂任务工具 → "碰到金融问题自己别上";工具名/schema 一经发布冻结(DSH KV-cache 前缀稳定依赖)。
10. **鉴权只用 BYOK,不做平台 Key**:THS/Wind 商用条款限制再分发/转售,平台 Key 本质是转售第三方数据,可能违约;AKShare 无 Key。
    Key 保管走 DSH credentials 服务,不塞进 cordis.yml 明文。
11. **DSH 接入形态:Python 统一 MCP server(FastMCP)+ dsh-mcp-client stdio 一条配置,TS 零代码**
    直连官方 MCP 是方案 A(~70 散装工具、无降级),原生 TS 插件是方案 C(重复造轮子)。
12. **v0.2.0 工具面变更 schema 评审记录 (2026-08-15 用户批准, PLAN-0.2.0.md §2.3)**
    - `fin_data__get_klines.period` 扩展 `1m/5m/15m/30m/60m`(向后兼容枚举扩展; 分钟线仅单交易日
      `start==end`, Wind 独家无降级源; 周/月/季明确拒绝) — 用户裁定"扩展 period 而非新工具"
    - 新增 `fin_data__get_announcements(symbol, start, end, top_k)` — Wind 独家 RAG, 无降级源
    - 新增 `fin_data__get_edb(indicator, start, end, observation)` — Wind 主干, AKShare 白名单兜底
    - 新增 `fin_data__reconcile(domain, symbols, start, end, tolerance_pct)` — 对账引擎
      (未复权+免费源间; 分歧不自动修复, 交 LLM 裁决; 信封 `source=""` + `engine: "reconcile"`)
    - v0.1.0 六个工具名与 schema 一字不动 (冻结契约保持)
13. **v0.3.0 工具面变更 schema 评审记录 (2026-08-15 用户批准, PLAN-0.3.0.md §2.3)**
    - 新增 `fin_data__get_fund_data(symbol, kind=quote|nav|kline|holdings|holders|performance|info,
      start, end, limit)` — 资产 gate: fund (etf/lof/otc/reits); kline 需 start/end;
      THS 免费主干 (快照仅 ETF; LOF/OTC 由 Wind 兜底=当日分钟行情 L3 标注)
    - 新增 `fin_data__get_index_data(symbol, kind=quote|kline|fundamentals|constituents|basicinfo,
      start, end, limit)` — 资产 gate: index; 行情 THS 主干 (无复权语义);
      fundamentals/basicinfo Wind 独家 (question 类, 无降级源); constituents 仅当前无历史
    - **analytics 域出局**: Wind `get_financial_data` 实测返回盈利预测+最高目标价+机构评级
      (100 行评级表) — 触及 LESSONS §1「研报/评级/目标价不覆盖」裁定, 不接线 (决策门 B, 2026-08-15)
    - `Instrument` L1 模型加 `subtype` 字段 (vendor 叶类别, 供 THS fund_type 细分) — 非工具面变更
    - v0.1.0/v0.2.0 九工具名与 schema 一字不动 (冻结契约保持)

## 结构(为什么不再 refactor)

```
core/            # 纯 Python,零协议依赖;domain + FinError 是唯一跨层契约
  domain/ symbols.py units.py routing.py
  adapters/      # 注册式:新源 = 新文件 + 配置两行,不动核心
servers/         # MCP 薄壳,只注册 fin_data__* 工具
agents/          # (未来)fin_agent__ask → 拆解 → todos → 子 Agent
config/          # chains.yaml / error_map.yaml / symbols.json(数据不是代码)
tests/           # golden(AKShare 回归)/ unit
```

## 路线图

| 阶段 | 内容 |
|---|---|
| P0 | core(domain/symbols/units/routing)+ THS、AKShare 适配器 + 错误分类 |
| P1 | 数据 MCP server 薄壳、BYOK 走 DSH credentials、缓存 TTL/信号量 |
| P2 | Wind 适配器、对账引擎(仅未复权+免费源间)、降级可观测性 |
| P3 | symbol 映射表自动同步、golden 回归 CI |
| P4 | agent 编排层(fin_agent__ask,数据层零改动) |
| P5 | 平台 Key + 配额/计费(先确认授权条款) |

## 数据源画像(主干/备用决策的依据)

| | AKShare | 同花顺 fuyao | 万得 Wind |
|---|---|---|---|
| 形态 | Python 库,344 接口,爬虫 | REST+MCP,33 工具,官方契约 | MCP,7 类 34 工具,商业 |
| 鉴权 | 免费无 | API Key + QPS 限流 | API Key + **积分计费** |
| 覆盖 | 最杂(含美股/加密/另类) | A股+基金,含热榜/异动/连板/龙虎榜独家 | 最全,分钟线/公告/EDB 自然语言 |
| 稳定性 | ❌ 爬虫易失效 | ✅ 契约稳定 | ✅ 商业级 |
| 亮点 | 免费兜底 | **Parquet 整库导出**(10年日K+复权因子,LLM-friendly) | 权威财务 + 官方已聚合 Tushare+78 技能 |

## 参考

- [OpenBB Standardization](https://docs.openbb.co/odp/python/developer/standardization)(适配深度)
- [vnpy datafeed 抽象](https://deepwiki.com/vnpy/vnpy/6.3-data-management-and-utilities)
- Wind 官方 `wind-find-finance-skill`(meta 入口模式)、`wind-alice`(A2A 分析 Agent)
