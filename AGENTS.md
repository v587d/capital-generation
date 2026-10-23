# Capital Generation 研发约定

> **读者是研发 Agent**。使用者指令住 persona + skill + 工具 `description`，与本文不共用文本；
> 不得把本文内容搬进 persona（§8.2）。
> - 本文只放**索引**与**动手前的闸门**（§3 §7 §8.3 §9 §10），详情按 §编号住 `docs/dev/`，按需 `Read`。
> - 本文件经 preset 的 `agent-instructions` 注入，`maxBytes: 16384` 是硬闸门（超出即截断尾部规则）。
>   行数、体积与 §指针一致性由 `test/dev-docs.test.mjs` 钉住：整数节只住本文，`docs/dev/*.md`
>   只有小数节且同一父节从 `.1` 连续。
> - **⛔ = 曾造成事故的硬约束**；改动须同步回归测试。只读事实以代码与工具 `description` 为准。
>   **README 是写给人看的**：不写 §编号、`docs/dev/`、`ctx.*` 一类实现层标识，改首页前过
>   `test/readme-prose.test.mjs`；说不清的用户影响就别写，只写读者看得见和要做的动作。

## 0. 阅读路径

| 你要动什么 | 详情在 |
|---|---|
| 角色边界、Dataset 消息 / 返回边界、capability 目录预算 | `docs/dev/data-roles.md`（§1.1 §1.2 §1.4 §1.5 §1.7）|
| 时间轴、日期归一、session 读取 | `docs/dev/time-axis.md`（§1.3）|
| shell 闸门、PTC 执行面、fs 写口与挂载 | `docs/dev/bash-gate.md`（§1.6）|
| web_retriever、本地回退、九个具名来源、文档解析 `ocr` | `docs/dev/web-retriever.md`（§4.1 §4.2 §4.3）|
| settings 卡片（host 平面嵌套包，座位在「插件」页） | `docs/dev/settings-config.md`（§5.1–§5.4）|
| `render_chart` 准入与呈现 | `docs/dev/chart-presentation.md`（§6.1 §6.2）|
| 交付登记与会话事件类型 | `docs/dev/chart-delivery-events.md`（§6.3）|
| preset 现状、人设落点、「不许改」全表、新增角色七处齐改 | `docs/dev/preset-persona.md`（§8.1 §8.2 §8.4 §8.5）|
| 外部 Skills 接入 | `docs/dev/selected-skills.md`（§8.6）|
| 精选 Skill 索引与标签注册表（含勾选上限） | `docs/dev/selected-skill-index.md`（§8.7）|
| 工具 schema 全表、数据源验收全表 | `docs/dev/tool-schema.md`（§9.1–§9.6 §10.1–§10.9）|

### ⛔ 硬约束一览

- **§1.1** 省往返靠 `isConcurrencySafe` + 框架并发池；体积闸门只有一道（`SAFE_RESULT_CHARS=7000` 小回执 + hint）——不合并多份 dataset，也不引入 digest / 裁剪阶梯。
- **§1.3** 日期串落到数值时间列必须 `query_type_conflict` 响亮失败；日期归一、session 读取与**工具授权判据**各只有一份实现、不提供兜底（`src/tool-exec.ts`；授权按 preset 身份判、不看 `parentSession`，§1.1）。
- **§1.6** bash / `run_code` 闸门不是安全边界（沙箱只拦写），别把它写成边界；guard 刻意不解析命令或程序内容。
- **§5.1** 可编辑配置只坐 `plugins.bundle.config`（key = 组合包名）一处，不开行级座位：每深一跳就多一次"设置里没这个插件"。
- **§6.1** 根收敛监听挂 `ctx.root`（standing 层收不到）；身份闸门全局装、调用期现读
  （created 时人设未定）。委派出口只有专用角色，工具面 = preset 挂的族行（allow 清单禁恢复）。
- **§6.1** `/capital-charts` 序列旁路必须接 `connection.requestRejection`，否则是无认证端点。
- **§6.3** 会话事件词汇表是闭集，交付必须走 first-party `deliverables/presented`；cordis ctx 不能用
  `{ ...ctx }` 展开；队列按 owner 归档；auto 模式在收尾流 finish 帧写交付（L34），回合钩子会落空。
- **§8.6** 接入必查清单先过：取数一律委派、不许用记忆回填、不带执行面；frontmatter/目录须可发现；catalog 与打包约束见详情。
- **§9.5 / §9.6** 工具返回值必须无损 JSON（`undefined` / `NaN` / 空洞不许带出），且必须满足自己
  声明的 `output.schema`——多返回一个未声明字段同样致命。

## 1. 角色边界与数据调度纪律

```text
main Agent
  +-- data_collector   外部取数，立即持久化，只回传 DatasetRef
  +-- data_junior      质量 / 统计 / 可视化 gate（PTC `run_code`），只回传 profile_ref / 聚合结果 / chart_ref
  |     └── visualization_specialist  异步出图，只回传 chart_ref / 小回执
  +-- data_analyst     Python 分析（仅预留，未启用）
  +-- web_retriever    网页材料获取（一次一个）
```

一句话版：**原始 rows 永不出工具层**，Agent 间只传 `DatasetRef` / profile 引用 / 聚合结果；主 Agent
一律委派（工具层拒绝它直连 Dataset 系列）、自己不出图；专用角色是叶子、互通须经主 Agent 中继；data_junior 的唯一执行面是 PTC `run_code`（不挂 shell），程序只调度工具与算术、不读落盘文件。主 Agent 委派后调 `wait_for_agents` 等子树收敛，不以等待行结束回合。

## 2. 项目结构

```text
capital-generation/
├── preset/capital-generation/    # 装配（agent.patch.yml = 一颗 @deepseek-ai/dsh-agent-preset
│   └── skills/                   #   声明行 + README.md 设计理由，不注入模型）+ 长协议与任务 skill
├── src/
│   ├── index.ts                  # 装配入口
│   ├── tool-exec.ts              # callerSession / delegatedSession 唯一实现
│   ├── data-collector/           # Dataset store / hub / dataset 工具 / 时间轴
│   ├── sources/fuyao-rest.ts     # Fuyao 端点定义表（能力清单见 list_capabilities）
│   ├── chart/                    # render_chart（出图）+ present_charts（收尾交付）/ events.ts 交付登记
│   ├── agents/                   # root-tool-policy（根收敛）+ bash-guard（§1.6）
│   ├── net/                      # 出网共用实现（§9.7）
│   ├── web-retriever/            # anysearch / wind-client / 具名来源 / 检索工具
│   ├── ocr/                      # PaddleOCR job / markdown 归一 / 落盘（§4.3）
│   └── time/tools.ts             # get_local_datetime
├── chart-ui/ config/ watchlist/  # host 平面嵌套包（图表 UI + 序列旁路；settings 卡片 §5）
├── vendor/                       # 固定版本第三方前端库（lightweight-charts）
├── docs/                         # dev/ = 本文详情层；reference/dsh-surface-ledger.md = 扩展面账本
└── lib/ test/ scripts/ assets/   # 构建产物 / *.test.mjs / session-trace 等 / README 素材
```

## 3. 数据布局（`{{cwd}}/` 下，服从当前 session 权限）

```text
capital-data/datasets/<dataset_id>/raw.json   # 原始 Dataset，不可变，默认保留 7 天
capital-data/profiles/<profile_id>/profile.json
capital-data/ocr/<doc_id>/                    # ocr 产物：document.md + meta.json（§4.3）
capital-analysis/charts/<chart_id>/           # render_chart 产物：spec.json / series.json / chart.html（自包含）
capital-analysis/runs/<analysis_id>/          # 预留（data_analyst）
```

业务数据（Dataset/profile/chart/ocr）不落 `.dsh` 或 DSH home；跨 Agent 只传 workspace opaque 引用；用户级资产（自选股）落宿主 storage-domain；内存只留 in-flight。

## 4. web_retriever 纪律

模型侧纪律在主 / 子 persona 与 skill `capital-web-protocol`（都有断言）；维护者结构事实——三类工作面
（含文档解析 `ocr`）、本地回退边界、输出预算与 `ocr` 的 job 生命周期与落盘——在 `docs/dev/web-retriever.md`。

## 5. settings 配置纪律（`capital-config`，host 平面）

卡片是 host 平面独立嵌套包（`cordis.patch.yml` insert 行）；可编辑面就是条目 Config 的 `.volatile()` 字段（命名空间 ≡ 条目 id，**四处同字**），密钥只进 credentials 域；细节全在 `docs/dev/settings-config.md`。
**⛔ 卡片坐「插件」页该 bundle 自己的「配置」段**（槽 `plugins.bundle.config`，key = 包名），**不在行详情页、不在「设置」页**；条目 id 与包名任一处漂移 = 卡片静默消失（§5.1 §5.4）。

## 6. 图表呈现纪律（`render_chart`，只有 visualization_specialist 持有）

准入与 gate（`ctx.root` 收敛、只有专用角色持有出图链、序列旁路认证）在 `docs/dev/chart-presentation.md`；
交付登记与回合归属（事件闭集、ctx 展开、寄存归档）在 `docs/dev/chart-delivery-events.md`。

## 7. 已删除、禁止恢复

- **`final_report` 全链路**（registry / `/capital-reports` / 报告卡 / skill）：根因"协议鼓励
  `verified`、宿主一律拒绝"；报告正文本来就是最终答复。**禁止恢复**；结论、证据、来源与局限写在最终答复里。
- **turn-tail 图表卡片通道与自定义会话事件类型**：禁止加回（判据 §6.3；`client.src.cjs` 只留
  `tool.call.toolview['render_chart']` 卡片、`exports.inject` 只有 `slots`；回归 `test/chart-client.test.mjs`）。

## 8. Preset 维护纪律

现状、人设落点判据、「不许改」全表、新增角色的七处齐改（§8.5）见 `docs/dev/preset-persona.md`。

### 8.3 改完后必须验证（缺一不可）

1. **挂载验证**（`agentPresets.resolve(id)` 无 `broken`，`compositionInventory()` 新增行 active；失败信息点名问题行）
2. **`npm test` 全绿**（会先 build）。测试断言实测教训，不准删断言变绿；规则迁移须同步断言。persona / `agent.patch.yml` 体积与文档行数闸门见相应测试。改过运行时路径、换行或子进程形状，勿放宽 `test/cross-platform.test.mjs`。
3. **测试跟随本机 dsh 版本**：`dsh-persona` 字段是 `prefix` 不是 `text`（`test/persona.test.mjs` 有核对用例）；字段变化须只在**一条**用例里失败并点名文件。
4. 动过 preset 行 / host 平面 / 交付事件，再跑 `npm run check:dsh`（扩展面账本逐条探测）。

## 9. 工具 schema 纪律（改任何模型工具定义之后）

全表在 `docs/dev/tool-schema.md`。四条硬指标：① §9.1 `parameters` 根只能是 `jsonObject()` 的
`{ type:'object', properties, required }`（根级组合子或不写 `type` 会被供应商在第一个 token 前 400）；
② §9.2 多形态靠可选属性 + 边界归一化；③ §9.3 新工具**必须经 `apply()` 注册**才在回归保护内；
④ §9.4 改完 `src/` 必须重建并**重启 dsh 进程**。两条 ⛔ 见上面 §9.5 / §9.6。

### 9.7 同一能力接多个入口：共用一份实现、逐入口验证

两次事故同一族（§1.3 日期归一漏接、session 读取漏接框架形状）：**本地测试只覆盖了接好的入口**。
自检：① 实现是否只有一份（`query-time.ts` / `tool-exec.ts`）？② 所有入口都接上了吗（`grep` 调用点）？
③ 每个入口有对等断言吗？④ 测试用**框架真实 exec 形状**（`exec.agent.session`）吗？⑤ 注册是否押在装配期读一次的外部状态上？
外部时刻留到调用期，注册只看结构；失败也不要 memoize，否则一次装配期抢跑会钉到进程结束（自选股 `domain()` 的永久 `store_unavailable`）。

## 10. 数据源验收纪律（改 `src/sources/*.ts` 之后）

全表在 `docs/dev/tool-schema.md` §10.1–§10.9。底线：**注册新能力要同时补巡检条目**（§10.8 四态之一，改法 §10.9）；
改端点同步 `npm run docs:capabilities`；新护栏先拿官方示例 / 真报文验过；`2004` 不注册、`5003` 是数据缺口。

## 11. 代码注释纪律（改任何源文件之后）

默认不写。只保留代码说不出的**约束与坑**：安全/身份边界、失败方向、顺序与生命周期、上游怪癖、魔数依据。
删历史复盘（日期、会话 id、事故经过）、代码复述、分段横幅、注释掉的代码，以及只重复类型的
`@param` / `@returns`。文件头 ≤5 行，单点一行；优先英文（中文只用于原文报错、用户文案或中文术语更准处）。
细节住 `docs/dev/`，只留指针；生成物（`lib/`、生成的 `client.js`）不手改；指令注释不删。