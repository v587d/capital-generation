# Changelog

本文件是 Capital Generation 的完整变更历史（README 只保留最近一版摘要，GitHub Release
说明从这里对应段落复制）。

**版本号口径（本仓实践）**：
- **第三位（patch）**：不破坏既有工具 / 配置 / 会话的新增与修复（如 2.1.1、2.1.2）。
- **第二位（minor）**：有需要用户知晓的行为变更，且段内附迁移说明（如 2.1.0 的图表呈现通道重做）。

## [2.1.2] - 2026-09-23

非破坏性新增：`data_junior` 多了一个默认入口 `describe_dataset`；`time_facts` 增字段、
`resolve_data_time_range` 增一种形态（原形态行为不变）、`query_dataset` 的 filter 多接受一种日期写法。
从 2.1.1 升级无需迁移：既有调用方式全部照旧，只有两处结果比以前更"紧"——日期串配
`>` / `<` / `!=` / `in` 由静默跳过改为报错，`columns_of_interest` 现在也收窄 `time_facts`
的首末值（详见 Fixed）。

### Added

- **`describe_dataset`：读一份 Dataset 的默认入口**（`src/data-collector/describe.ts`）。一次调用完成
  inspect（元数据与 `query_access.shape`）+ profile（四类事实、写入 `profile_ref`）+ 可选的受控 `queries`，
  取代默认流程里的 `inspect_dataset → profile_dataset → query_dataset` 三步往返（三步保留给单点复核）。
  一次只处理一个 `dataset_id`，多份数据在同一条 assistant 消息里一次发完即可并发执行、结果一起返回；
  document 型由宿主跳过 `queries` 并在 `warnings` 说明；结果超过 7000 码点不再返回超长载荷，改回
  `{status:"too_large", profile_ref, columns, hint}`，让调用方按 `columns_of_interest` 收窄后重发一次
  （**看到 `too_large` 不是失败**，它带着完整列名）。
- **时间轴：日历由宿主换算**（`src/data-collector/time-axis.ts`）。`time_facts` 现在除覆盖范围
  与首末行外，还给出 `covered_from_iso` / `covered_to_iso`、`axis`（`value_format` / `time_zone` /
  `utc_offset` / `aligned_to`，按**该列自身观测到的**偏移推断）与 `windows[]`（近 1 月 / 近 3 月 /
  近 1 年 / 年初至今的 `value_ge` / `value_le` 与 `data_from` / `data_to`）。
- **`query_dataset` 的 filter 直接接受日历写法**：`YYYY-MM-DD` / `YYYY-MM` / `YYYY` /
  `{ "period": "last_1_month" }`，宿主按该列偏移归一；结果自动补 `*_iso` 可读时间列。
  相对期省略锚点时以该 Dataset 最后一天为准。
- **`resolve_data_time_range` 新增 Dataset 形态**：传 `dataset_id`（可选 `time_column`）+ `period`
  时，按该 Dataset 的时间轴输出 `bounds` / `range` / `data` / `dataset`，边界可直接填进
  `query_dataset` 的 filter。传 `capability + period` 的原形态行为不变。

### Changed

- **`data_junior` 的 persona 与两份 skill 改以新入口为准**：读 Dataset 默认 `describe_dataset`
  （多份在同一条消息里并发，`columns_of_interest` 是收窄结果体积的唯一手段），
  `inspect_dataset` / `profile_dataset` / `query_dataset` 降为单点复核；同时给可视化协议补两条硬规则——
  `chart_source_ref` 一张图一个 token（15 分钟 TTL，不为同一 Dataset 重签），spec 由
  `visualization_specialist` 组装、`data_junior` 只交"要什么视图"，协议排除的视图记为 limitation
  而不是改方案重签。

### Fixed

- **`describe_dataset` 内嵌 queries 的时间筛选与 `query_dataset` 行为不一致（2026-09-23，真机会话 `66fa9666`）**：
  日期串归一最初只接在 `query_dataset` 上，内嵌 queries 直连引擎，于是同一回合里模型看到两种行为——
  `query_dataset` 的 `">=": "2026-09"` 正确按区间筛，而内嵌的 `">=": "2026"` 被引擎当**数字 2026** 比较
  （243 行全中、`days_2026: 243` 静默错数）、`">=": "2026-07"` 被 `skip_with_warning` 整条跳过（0 行）。
  归一实现已收敛到 `src/data-collector/query-time.ts`，两个入口共用；内嵌结果同样补 `*_iso` 可读时间列。
- **`resolve_data_time_range` 的 Dataset 形态对任何调用方都报 "requires an authorized session"（同一起事故）**：
  该形态把 session 读成 `exec.session`，而框架一直放在 `exec.agent.session`。现在 session 读取收敛到
  `src/tool-exec.ts` 一份实现（`dataset-tools.ts` 与 `time/tools.ts` 共用，且**不提供** `exec.session` 兜底）；
  Dataset 形态同时按 Dataset 系列工具的边界收敛为"只对**被委派**的子 Agent 开放"，主 Agent 仍可用取数形态。
- **`columns_of_interest` 现在也收窄 `time_facts` 的首末值投影**：此前它只影响
  `statistics`/`categories`/`schema`，而 `first`/`last` 仍带每个数值列（7 列日线 = 每个投影 7 个键），
  与参数在描述里的承诺不符。时间列永远保留（首末值的时间坐标）；实测收窄到 2 列时由 7/7 键变为 3/3 键。
- **`resolve_data_time_range` 的 capability 形态每次调用都失败（2026-09-23，真机会话 `cf464cb6`）**：
  `mode` 此前被列入工具 `output.schema` 的 `required`，却只在 Dataset 形态返回它 —— 宿主的
  `createSuccessResult` 会按 `output.schema` 校验返回值，于是 capability 形态稳定抛
  `ToolOutputError: returned invalid output: missing required property "value.mode"`。
  `data_collector` 与 `web_retriever` 都受影响，模型把同一条调用重试 3 次后卡死。
  现在两种形态都返回 `mode` / `format` / `timezone` / `warnings` 这四个共有字段（Dataset 形态另带
  非交易日提示），`required` 只列它们。
- **`period` 被序列化成 JSON 字符串时解析不了**：`'{"unit":"year","count":2}'` 掉进
  `unsupported period`（两个子 Agent 各自白跑一轮）。现在字符串化的 `{unit,count}` 与对象形态等价；
  Dataset 形态也不再丢掉对象形态的 period（此前会静默退化成"全部历史"）。
- **日期串落到数值时间列不再静默放行**：旧行为下 `skip_with_warning` 会把这条 filter 整条跳过
  （`filter X skipped incompatible value`），于是"筛选消失、返回全量"却看起来成功。
  现在 `>` / `<` / `!=` / `in` 配日期串一律 `query_type_conflict`，并说明改用 `>=` / `<=`。
- **`last_N_week` 的空窗口**：`shiftDate` 的 `amount * 7` 与调用方的 `count - 1` 叠加，
  使 `last_1_week` 退化成 0 天。现在周就是 7 天，"含锚点当天"只减一次。
- 秒级 epoch 或混合类型的时间列不再被误判成"日粒度毫秒"（`MIN_EPOCH_MS` 量级闸门）；
  时间轴探针只读前 500 行；窗口覆盖不到任何行时报错并回显数据覆盖范围。

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
