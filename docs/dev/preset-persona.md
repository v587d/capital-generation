# Preset 维护：现状、人设写作与「不许改」

> 索引见仓库根 `AGENTS.md` §8。改 `preset/capital-generation/` 的任何一行之前读这里；验证步骤
> （§8.3）与新增角色流程（§8.5）留在 `AGENTS.md`，因为它们是每次动手都要过的闸门。
> §编号沿用 `AGENTS.md` 的全局命名空间。

## 8.1 现状（实测于 dsh 0.1.5-rc.2）

- `preset/capital-generation/` 由 `cordis.patch.yml` bundle patch 以 system root 挂载
  （`trust=system`）。**不要**手抄进 `~/.dsh/.agent-presets`，也不要编辑 DSH 自带安装目录
  （`standard` / `ptc` / `minimal` / `cordis`）——要改就复制成本地 preset。
- 主 persona 由 `@deepseek-ai/dsh-persona` 行 `config.prefix` 承载（**没有** `config.text`）；
  不设 `suffix` 时部署级后缀被遮蔽为空（有意）。子 persona 由委派行 `config.persona` 承载：
  同一节名注册进子 scope，**最近 scope 胜出 ⇒ 覆盖（不是追加）**主 persona。
- 长协议由 `skill-filesystem` + `tool-skill` 两行发现；组合设计理由住同目录 `README.md`（不注入
  会话）；**本文与 `docs/dev/` 是给研发 Agent 的，使用者 Agent 只读 persona + skill + 工具
  description**，两侧受众不共用文本，也不得为腾地方把本文内容搬进 persona。
- 工作区约定由 `agent-instructions` 行注入 `AGENTS.md`（宿主那份在本 profile 被关，由 preset 自持
  这一行）。它沿 session cwd 向上走到 project root 逐层读候选名（`AGENTS.md` / `CLAUDE.md` +
  `.local` 覆盖，按 trimmed 内容去重），**cwd 以下的子目录不会被扫**——所以 `docs/dev/` 靠指针
  按需 `Read`，模块级 `AGENTS.md` 在这里不成立。

## 8.2 人设写作方法（主 / 子 persona 一视同仁）

先问：**这条内容在"模型还不知道本轮要做什么"之前就必须生效吗？**

| 属于 | 落点 |
|---|---|
| 每轮硬规则（常驻） | persona（主 / 子）：预检、label 复用、路由、权限 / 叶子边界、安全底线、"第一步先加载协议" |
| 按需参考材料 | `skills/<name>/SKILL.md`：样例 JSON、字段规则、`error/code` 处置表、核验清单 |
| 维护者理由 / 踩坑 | `docs/dev/`（研发 Agent 按需读）与 `preset/capital-generation/README.md`：isolate realm、`!!js` 解析、provider 故障史 |

- 与工具 description / schema 重复的事实**不要再抄进 persona**（判据："该 Agent 可见的工具文本里
  是否已有"）。任何进 `skills/` 的文件都会拿一条常驻目录项并可被模型加载——维护者文档不放这里。
- 写错的代价：硬规则进 skill = 降级成"想起来才生效"；参考材料留 persona = 每轮付 token。

## 8.4 不许改（除非有明确设计决策，并同步测试）

- **persona 只放每轮硬规则**（判据 §8.2）：`list_agents` 每轮预检、label 精确复用、同角色复用
  不新建、`description` = 角色标签、durable id、委派清单与 `waiting_data`、路由表、禁主 Agent
  直连数据工具与检索、子 Agent 互通经主 Agent 中继、全部 continuable、安全合规底线、叶子边界与
  「第一步先加载协议」。长协议 / 示例 JSON / 重试表 / 清单格式一律进 `skills/`。
- **不要在插件代码里注册 skill provider**（`ctx.skills.registerProvider` 等）：Skills 由组合行承载。
- **子 Agent 读 skill 的唯一开关是 allow 里的 `skill`**：restriction 过滤继承层、只豁免本 scope
  自注册工具；这条链上任一环改动（toolFilter / skill 名 / 文件名）都要同步测试。
- `dataCollectorHub` / `datasetStore` 必须留在 `capital-generation-scope` 的 isolate realm 内
  （出 realm 会进程级冲突）；`compaction` / `toolResultPruner` 同在 `compaction` 组 realm 内
  （pruner 是该组 id 为 `tool-result-pruner` 的**子行**）。
- `toolFilter.allow` / `deny` 只写**真实注册**的全局工具名（写错的表现是"创建子 Agent 失败"）。
  宿主 `web_search` / `web_fetch` 不由本插件注册，**只准在 `ROOT_AGENT_DENIED_TOOLS` 层 deny**。
- **四组结构件，删任一处该闸门就退回"persona 软建议"**：① 可视化 gate（§6.1 三件套 + §6.3 两处
  联动 → `chart-presentation.md` / `chart-delivery-events.md`）；② bash 闸门（§1.6 两结构件 +
  shell 槽位 → `bash-gate.md`）；③ 出网只有一个入口：`RETRIEVAL_DENIED_TOOLS`
  （`src/agents/root-tool-policy.ts`，13 个检索 / 来源工具名的**唯一事实来源**，spread 进
  `ROOT_AGENT_DENIED_TOOLS`，**新增来源只改这一处**）+ 通用 subagent deny + 主 persona 禁直连
  文案；④ 本地回退开关支配九个具名来源（§4.1 → `web-retriever.md`）。②③ 由
  `test/persona.test.mjs`（无通配 + deepEqual 对齐同一名单）与 `test/root-tool-policy.test.mjs`
  （名单长度 13）钉死。**教训**：`工具前缀_*` 通配在工具改名后一个都不匹配——禁直连文案必须
  **只点名宿主的 `web_search` / `web_fetch`**。
- **`data_analyst` 保持 `disabled`**。启用前需同时满足：宿主 Python runner + coding 工具；插件注册
  `read_profile`；更新本文 §1；更新测试预留断言；shell 槽位进 allow 并重定沙箱写边界（写
  `capital-analysis/runs/` 需 `workspace-write`，不要 read-only 钉会话，§1.6）。

## 8.5 新增或修改一个角色

1. 按 §8.2 定落点。2. 专用角色**六处齐改**：委派行（allow 必须含 `skill`）、子 persona（骨架 +
   第一条 duty `skill <name>`）、`skills/<name>/SKILL.md`、主 persona 路由与复用、本文 §1.1
   （`data-roles.md`）、测试断言。3. 挂载验证（§8.3 第 1 项）+ `npm test` + 开一个 Capital 会话
   确认工具表与首轮预检。
