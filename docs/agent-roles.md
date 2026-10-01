# Agent 角色与 DSH 能力复用

> 本文件是 [README](../README.md)「🔍 What」的详情层：README 只留一张角色一览表，逐角色职责与逐条
> 基础设施复用清单都在这里。文中所有事实与 `preset/capital-generation/agent.patch.yml` 的装配一致，
> 装配能起由 `npm run smoke:boot` 在真实 boot graph 里验证。

## 总原则

所有 Agent，包括主 Agent 均不能直接接触原始结构数据（行情、财务报表细目等），需要时 Agent 可按需提取
再提炼发送消息至主 Agent。序列数据同样不进模型上下文：落盘成不可变 Dataset，跨 Agent 只传引用。

## 角色详情

目前覆盖以下 Subagent（data_analyst 为预留角色，暂未启用）：

- **data_collector**: 主 Agent 直属下级（spawn），负责根据上级指令收集金融财经类结构化数据，目前支持
  **69 个数据 capability**：同花顺（fuyao）61 个（行情、财务、估值竞价、盘面特色、指数、基金），
  腾讯公开 HTTP 3 个（实时行情快照 / 复权与分钟 K 线 / 分笔，行情 fallback），东方财富 HTTP 5 个
  （龙虎榜汇总、限售解禁日历、板块行情排名与资金流）。后两类走公开端点，无需额外密钥。
  能力清单见 [data_collector 能力总表](data-collector-capabilities.md)。
- **data_junior**: 主 Agent 直属下级（spawn），负责根据上级指令清洗、整理出有效数据、基础描述性统计
  以及数据透视，目的是阐述数据背后的"故事"。读一份 Dataset 默认走 `describe_dataset`（一次调用完成
  元数据 + 基础 profile + 受控查询，多份数据在同一条消息里并发）；时间窗与时间戳换算一律由宿主完成
  （`time_facts` 的 `axis` / `windows`、`resolve_data_time_range`），子 Agent 不自行把日期算成毫秒。
- **data_analyst**: 主 Agent 直属下级，负责根据上级指令，通过运用编程技能分析上游数据
  （**仍在开发中**，委派行 disabled，暂不启用）。
- **web_retriever**: 主 Agent 直属下级（spawn），负责根据上级指令，运用网络搜索和抓取能力，获取外部
  非结构化数据。检索面为 AnySearch（`anysearch_search` / `web_retriever_fetch`，失败可按开关回退本机
  直连）与 Wind Alice（`wind_docs_announcements` / `wind_docs_news`，公告与权威新闻）；另有九个
  **具名来源查询工具**（财联社快讯、华尔街见闻快讯、东财 7×24 快讯 / 个股新闻 / 个股研报、新浪研报、
  同花顺机构一致预期 EPS、巨潮互动易、上证e互动），均为公开端点、零密钥；第三个工作面是**文档解析**
  `ocr`（PaddleOCR，PDF 研报 / 公告正文与图片 → markdown，需 Token）。共 14 个工具，逐个说明见
  [web_retriever 能力](web-retriever-capabilities.md)。
- **visualization_specialist**: 主 Agent 的孙 Agent（data_junior 的 one-shot 前台子 Agent），由
  data_junior 在 profile 完成后的可视化 gate 中按需创建；只接收 `profile_ref`、有限 profile 事实与
  短期 `chart_source_ref`，使用受控 `render_chart` 生成自包含 HTML 图表，并只向 data_junior 回传
  `chart_ref` 小回执；不接触原始 rows、不向主 Agent 直接发消息，当前是唯一的 one-shot 角色。
- 未来更多，欢迎 PR

## 复用的 DSH 官方基础设施

沿用 DSH 官方基础设施，不自行实现底层机制：

- **预设挂载**：整份装配由一颗官方 `@deepseek-ai/dsh-agent-preset` **声明行**声明
  （`config = { id, plugins }`），组合与 `agentPresets` 服务归宿主；插件不扫目录、不自建 registry。
  `config.id` 是写进会话日志的身份，历史会话靠它恢复。
- **Subagent 编排**：通过官方 `dsh-subagent` 行注册委派工具，子 Agent 的创建、消息收发与生命周期管理
  完全交给宿主；本插件只定义每个角色的 persona 与 toolFilter。
- **人设注入**：通过官方 `dsh-persona` 行声明主 Agent 人设，不占用 `deployment:persona` 节；
  子 Agent 人设由委派行 `config.persona` 承载，由宿主自动注入子 Agent 作用域。
- **技能注入**：主 persona 只保留每轮都要生效的硬规则（预检、复用、路由、合规），长协议与载荷示例放在
  preset 自带的 `skills/` 目录，由 `dsh-skill-filesystem` + `dsh-tool-skill` 两行按需加载；
  插件代码不注册 skill provider。
- **工作区约定**：通过官方 `dsh-agent-instructions` 行加载工作区 `AGENTS.md` / `CLAUDE.md`。
- **上下文压缩**：通过官方 `dsh-compaction-basic` / `dsh-compaction-tool-result-pruner` 行提供长会话
  压缩与大结果剪枝。
- **数据持久化**：通过宿主侧 `fs` / `sandboxPolicy` 服务完成 Dataset 落盘与权限校验，不直接操作文件系统；
  所有数据落在用户 workspace，服从当前 session 的沙箱策略。
- **用户级资产**：自选股这类**跨 workspace** 的用户数据走官方 `dsh-storage-domain`
  （域 `capital_watchlist`，落 `~/.dsh/storages/`），不自建文件路径；浏览器半边只与本机 loopback 上的
  宿主路由对话，密钥从不进浏览器。
- **配置与凭据**：可编辑项就是插件条目 Config 里标了 `.volatile()` 的字段，DSH 自动把它投影成「插件」页
  上的表单（命名空间恒等于条目 id），插件不自建设置界面；API Key 经宿主 `credentials` 服务解析引用，
  不硬编码、不缓存、不写进配置文档、不随响应出网。
- **工具注册**：通过官方 `tools` 服务向会话注册模型工具，由宿主统一管理工具的生命周期与权限控制。
- **用户交互**：复用官方 `ask_user_question`、`todo_write`、`send_message`、`list_agents` 等工具，
  不重复造轮子。

这些通道全部由上游提供，改名或删行的症状是"起不来"或"静默读不出"。因此每一条都登记在
[DSH 接口账本](reference/dsh-surface-ledger.md)里并配一支探针，`npm run check:dsh` 逐条核对
（现 24 条）。升级 DSH 前先跑它。
