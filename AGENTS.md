# Capital Generation 研发约定

> **读者是研发 Agent**（改本仓代码的你）。使用者 Agent 的运行时指令住 persona + skill + 工具
> `description`，与本文**不共用文本**；不得为腾地方把本文内容搬进 persona（落点判据 §8.2）。
>
> - 本文只放**索引**与**每次动手都要过的闸门**（§3 §7 §8.3 §9 §10），详情按 §编号住 `docs/dev/`，
>   靠指针按需 `Read`（DSH 只从 session cwd 往上找指令文件，子目录不会被注入）。
> - 本文件由 preset 的 `agent-instructions` 行注入会话，`maxBytes: 16384` 是硬闸门（超出即截断，
>   尾部规则静默消失）。行数、体积与 **§指针一致性**由 `test/dev-docs.test.mjs` 钉住：整数节只住
>   本文，`docs/dev/*.md` 只有小数节且同一父节从 `.1` 连续。不手工维护"谁引用了哪节"的清单。
> - **⛔ = 曾造成真实事故的硬约束**；改动须有明确设计决策并同步回归测试。只读事实（字段、schema、
>   能力清单）以代码与工具 `description` 为准，本文不抄。

## 0. 阅读路径

| 你要动什么 | 详情在 |
|---|---|
| 角色边界、Dataset 消息 / 返回边界、capability 目录预算 | `docs/dev/data-roles.md`（§1.1 §1.2 §1.4 §1.5）|
| 时间轴、日期归一、session 读取 | `docs/dev/time-axis.md`（§1.3）|
| data_junior 的 bash 闸门与 shell 挂载 | `docs/dev/bash-gate.md`（§1.6）|
| web_retriever、本地回退、九个具名来源 | `docs/dev/web-retriever.md`（§4.1 §4.2）|
| settings 卡片（host 平面嵌套包） | `docs/dev/settings-config.md`（§5.1–§5.3）|
| `render_chart` 准入与呈现 | `docs/dev/chart-presentation.md`（§6.1 §6.2）|
| 交付登记与会话事件类型 | `docs/dev/chart-delivery-events.md`（§6.3）|
| preset 现状、人设落点、「不许改」全表、新增角色六处齐改 | `docs/dev/preset-persona.md`（§8.1 §8.2 §8.4 §8.5）|
| 工具 schema 全表、数据源验收全表 | `docs/dev/tool-schema.md`（§9.1–§9.6 §10.1–§10.5）|

### ⛔ 硬约束一览

- **§1.1** 省往返靠 `isConcurrencySafe` + 框架并发池；体积闸门只有一道（`SAFE_RESULT_CHARS=7000`
  小回执 + hint）——不合并多份 dataset，也不引入 digest / 裁剪阶梯。
- **§1.3** 日期串落到数值时间列必须 `query_type_conflict` 响亮失败，不许静默跳过 filter；日期归一
  （`query-time.ts`）与 session 读取（`src/tool-exec.ts` 的 `exec.agent.session`）各只有一份实现，
  新增入口必须复用、不提供兜底。
- **§1.6** bash 闸门不是安全边界（沙箱只拦写），别把它写成边界；guard 刻意不解析命令内容。
- **§6.1** 根收敛监听只能挂 `ctx.root`（挂 standing scope 收不到且不报错）；通用 `subagent` 行必须
  带 `toolFilter.deny`，否则通用 child 继承全部工具能自己出图。
- **§6.1** `/capital-charts` 序列旁路必须接 `connection.requestRejection`，否则是无认证端点。
- **§6.3** 会话事件词汇表是闭集，交付必须走 first-party `deliverables/presented`；cordis ctx 不能用
  `{ ...ctx }` 展开（`get`/`on`/`effect` 挂在原型上）；寄存队列按 owner（根会话）归档。
- **§9.5 / §9.6** 工具返回值必须无损 JSON（`undefined` / `NaN` / 空洞不许带出），且必须满足自己
  声明的 `output.schema`——多返回一个未声明字段同样致命。

## 1. 角色边界与数据调度纪律

```text
main Agent
  +-- data_collector   外部取数，立即持久化，只回传 DatasetRef
  +-- data_junior      质量 / 统计 / 可视化 gate，只回传 profile_ref / 聚合结果 / chart_ref
  |     └── visualization_specialist  one-shot 出图，只回传 chart_ref / 小回执
  +-- data_analyst     Python 分析（仅预留，未启用）
  +-- web_retriever    网页材料获取（一次一个）
```

一句话版：**原始 rows 永不出工具层**，Agent 间只传 `DatasetRef` / profile 引用 / 聚合结果；主 Agent
一律委派（工具层拒绝它直连 Dataset 系列）、自己不出图；专用角色是叶子、互通须经主 Agent 中继；
`data_analyst` 保持 `disabled`。

## 2. 项目结构

```text
capital-generation/
├── preset/capital-generation/    # 装配（preset.yml + agent.cordis.yml + README.md 设计理由，
│   └── skills/                   #   不注入模型）+ 五个长协议 skill，主 / 子 Agent 按需加载
├── src/
│   ├── index.ts                  # 装配入口
│   ├── tool-exec.ts              # callerSession / delegatedSession 唯一实现
│   ├── data-collector/           # Dataset store / hub / dataset 工具 / 时间轴
│   ├── sources/fuyao-rest.ts     # Fuyao 端点定义表（能力清单见 list_capabilities）
│   ├── chart/                    # render_chart：spec 归一化 / 自包含 HTML / events.ts 交付登记
│   ├── agents/                   # root-tool-policy（根收敛）+ bash-guard（§1.6）
│   ├── net/                      # 出网共用实现（§9.7）
│   ├── web-retriever/            # anysearch / wind-client / 具名来源 / 检索工具
│   └── time/tools.ts             # get_local_datetime
├── chart-ui/ capital-config/     # host 平面嵌套包（图表 UI + 序列旁路；settings 卡片 §5）
├── vendor/                       # 固定版本第三方前端库（lightweight-charts）
├── docs/                         # dev/ = 本文详情层；reference/dsh-surface-ledger.md = 扩展面账本
└── lib/ test/ scripts/ assets/   # 构建产物 / *.test.mjs / session-trace 等 / README 素材
```

## 3. 数据布局（`{{cwd}}/` 下，服从当前 session 权限）

```text
capital-data/datasets/<dataset_id>/raw.json   # 原始 Dataset，不可变，默认保留 7 天
capital-data/profiles/<profile_id>/profile.json
capital-analysis/charts/<chart_id>/           # render_chart 产物：spec.json / series.json / chart.html（自包含）
capital-analysis/runs/<analysis_id>/          # 预留（data_analyst）
```

业务数据不落 `.dsh` 或 DSH home；Agent 间用 workspace-scoped 的 opaque `artifact_ref`，不传真实
绝对路径；内存只留 in-flight 请求与临时元数据，不做长期缓存。

## 4. web_retriever 纪律

模型侧纪律在主 / 子 persona 与 skill `capital-web-protocol`（都有断言）；维护者结构事实——两类
工作面、九个具名来源、本地回退的触发与边界、输出预算——在 `docs/dev/web-retriever.md`。

## 5. settings 配置纪律（`capital-config`，host 平面）

卡片是 host 平面独立嵌套包，由 `cordis.patch.yml` insert 行挂载；命名空间两处同改、密钥进
credentials 域、回退开关即时写与两处 schema 默认值逐字一致——全在 `docs/dev/settings-config.md`。

## 6. 图表呈现纪律（`render_chart`，只有 visualization_specialist 持有）

准入与 gate（`ctx.root` 收敛、通用 subagent 的 deny、序列旁路认证）在 `docs/dev/chart-presentation.md`；
交付登记与回合归属（事件闭集、ctx 展开、寄存归档）在 `docs/dev/chart-delivery-events.md`。

## 7. 已删除、禁止恢复

- **`final_report` 全链路**（registry / `/capital-reports` / 报告卡 / skill）2026-09-17 移除：根因
  "协议鼓励 `verified`、宿主一律拒绝"，且报告正文本来就是主 Agent 最终答复。**不要**以任何形式恢复；
  结论、证据、来源与局限一律写在最终答复里。
- **turn-tail 图表卡片通道与自定义会话事件类型**：2026-09-18 移除，禁止加回（判据见 §6.3；
  `client.src.cjs` 只留 `tool.call.toolview['render_chart']` 卡片、`exports.inject` 只有 `slots`，
  回归 `test/chart-client.test.mjs`）。

## 8. Preset 维护纪律

现状、人设落点判据、「不许改」全表、新增角色的六处齐改（§8.5）见 `docs/dev/preset-persona.md`。

### 8.3 改完后必须验证（缺一不可）

1. **挂载验证**：`agentPresets.standingKeyFor('capital-generation')` 成功；`compositionInventory()`
   新增行为 active（`FiberState.ACTIVE = 2`）。挂载失败信息会点名问题行。
2. **`npm test` 全绿**（会先跑 `npm run build`）。断言的是"实测教训"不是措辞，**不允许靠删断言
   变绿**：`assertRuleAny()` 全部落空 = 规则真消失，**补人设**；规则外迁时断言跟着改读目标正文。
   体积闸门（persona 与 `agent.cordis.yml`）见 `test/persona.test.mjs`，文档行数见
   `test/dev-docs.test.mjs`；上调须同步测试数字与理由注释。
3. **测试跟随本机 dsh 版本**：`dsh-persona` 字段是 `prefix` 不是 `text`（`test/persona.test.mjs`
   有核对用例）。字段名变化必须只在**一条**用例里失败并点名文件。
4. 动过 preset 行 / host 平面 / 交付事件，再跑 `npm run check:dsh`（扩展面账本逐条探测）。

## 9. 工具 schema 纪律（改任何模型工具定义之后）

全表在 `docs/dev/tool-schema.md`。四条硬指标：① §9.1 `parameters` 根只能是 `jsonObject()` 的
`{ type:'object', properties, required }`（根级组合子或不写 `type` 会被供应商在第一个 token 前 400）；
② §9.2 多形态靠可选属性 + 边界归一化；③ §9.3 新工具**必须经 `apply()` 注册**才在回归保护内；
④ §9.4 改完 `src/` 必须重建并**重启 dsh 进程**。两条 ⛔ 见上面 §9.5 / §9.6。

### 9.7 同一能力接多个入口：共用一份实现、逐入口验证

两次事故同一族（§1.3 日期归一漏接、session 读取漏接框架形状），共同特征：**本地测试只覆盖了
"接好的那个入口"**。自检清单：① 实现是否只有一份（`query-time.ts` / `tool-exec.ts`）？② 所有
会执行它的入口都接上了吗（`grep` 调用点，不凭记忆）？③ 每个入口有对等断言吗？④ 测试用的是
**框架真实 exec 形状**（`exec.agent.session`）而非自造简化形状吗？

## 10. 数据源验收纪律（改 `src/sources/fuyao-rest.ts` 之后）

全表在 `docs/dev/tool-schema.md` §10.1–§10.5。底线：改端点要同步 `npm run docs:capabilities`；**任何新护栏
先拿官方示例 / 真报文验过**（护栏拒绝官方示例就是真实取数事故）；`2004` 不注册、`5003` 是数据缺口。
