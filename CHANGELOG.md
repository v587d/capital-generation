# Changelog

本文件是 Capital Generation 的完整变更历史（README 只保留最近一版摘要，GitHub Release
说明从这里对应段落复制）。

**版本号口径（本仓实践）**：
- **第三位（patch）**：不破坏既有工具 / 配置 / 会话的新增与修复（如 2.1.1）。
- **第二位（minor）**：有需要用户知晓的行为变更，且段内附迁移说明（如 2.1.0 的图表呈现通道重做）。

## [2.1.1] - 2026-09-22

非破坏性版本：只增不改，从 2.1.0 升级无需迁移。

### Added

- **设置卡片**：设置 → 插件 → 插件配置 → Capital 模式，可视化配置 `FUYAO_API_KEY` /
  `ANYSEARCH_API_KEY` / `WIND_API_KEY`（等价于手写 `~/.dsh/.credentials.yaml`，两种方式并存）。
  同一卡片新增 **「允许启动本地提取网页内容」** 开关（`retriever.localFetch.enabled`，默认开启）。
- **AnySearch fetch 失败自动回退本机直连**：开关开启时，AnySearch `fetch` 失败（超时、
  上游错误、正文清洗失败等）会自动改由本机 HTTP 直连抓取该页面，HTML 经 turndown 转为
  GFM Markdown；回执 `via` 字段标注正文来源（`anysearch` | `local-http`），可审计。
  回退带 SSRF 门控，仅处理公开可访问的文本页面（HTML/文本/JSON/XML）；PDF、二进制与
  需登录页面不回退，仍原样失败。开关关闭时行为与 2.1.0 完全一致。
- AnySearch 失败按结构化错误码归类（`AUTH` / `RATE_LIMIT` / `TIMEOUT` / `UPSTREAM` 等），
  错误信封携带上游语义而非笼统失败。
- 新增 `npm run smoke:local-fetch`：本地 fixture 与真实网络双通道验证回退链路。

### Changed

- 本机直连默认 User-Agent 由裸版本号改为产品标识 `@v587d/capital-generation`
  （裸版本号是 WAF 眼里的典型爬虫特征）；显式配置的 UA 不受影响。

## [2.1.0] - 2026-09-20

本版是**图表呈现通道的定点重做**：修掉「打开历史会话失败」的根因，并把图表交付
交回 DSH 官方机制。**没有工具/接口层面的破坏性变更**，但呈现行为与 2.0.0 不同。

### ⚠️ 行为变更：图表不再内嵌在答复里

| | 2.0.0 | 2.1.0 |
|---|---|---|
| 呈现位置 | 主 Agent 答复里**直接内嵌的图表** | 收尾的**「本轮文件改动 / 交付」行** |
| 查看方式 | 页面内直接渲染 | 点开该行的 `chart.html`，右侧面板渲染可交互图表 |
| 承载机制 | 自定义会话事件 `capital/chart-rendered` + 客户端内嵌渲染 | 官方 `deliverables/presented` + 官方文档预览 |

降级路径不变：`chart.html` 自包含（内联图表库与数据），可离线打开、零外部请求。

### 🐞 修复：升级到 dsh 0.1.5-rc.2 后，出过图的会话 100% 打不开

根因（实测，非版本回归）：会话日志的事件词汇表是**闭集**，读取侧
`validateStoredEvents()` fail-closed——自定义事件 `capital/chart-rendered` 写入时静默
通过、冷加载时整份会话被拒（`unknown to this harness`）。rc.1 与 rc.2 的会话持久化包
逐字节相同，只是升级必然重启，把一直存在的隐患暴露出来。

修复：不再发明事件类型，图表呈现改用官方 first-party 通道 `deliverables/presented`，
并连带修掉交付链路上的一串缺陷（发布器进程级单例、待登记队列按会话归档、交付行在
`agent/turn-stopping` 冲刷等），交付通道首次真正跑通。

**已知残留**：带旧自定义事件的历史会话在新版本下**仍然打不开**（上游无 ignorable
逃生口，无法回填迁移）；新版本起产生的会话不受影响。

## [2.0.0] - 2026-09-17

### Added

- `visualization_specialist` 图表管线：`data_junior` 可视化 gate 按需创建 one-shot
  子 Agent，经 `render_chart` 生成自包含 HTML 图表（内联 Lightweight Charts v5.2.1），
  序列数据经旁路路由直达渲染、不进模型上下文；含抗上游漂移账本。

## 1.x（`v1-final`，2026-09-14）

早期版本，无独立变更记录，见 [Git 历史](https://github.com/v587d/capital-generation/commits/master)。
