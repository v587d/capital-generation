# 外部项目 Skill 接入与运行时约束

> 索引见仓库根 `AGENTS.md` §8。本文只记录把外部项目的 skill 接入本仓时已验证的发现、加载、隔离和打包行为；不规定候选评估或阶段状态。

## 8.6 外部项目快照与运行时接线

### 快照目录与发现

- 上游项目快照放在 `selected-skills/<repository>/`，保留上游自己的目录结构；`UPSTREAM.md` 记录仓库 URL、固定 commit、许可与本地改动，`LICENSE` 随快照保留。当前布局及说明见 [`selected-skills/README.md`](../../selected-skills/README.md)。
- provider 的 `customSkillDirs` 指向每个项目的 `skills/` 根目录。DSH filesystem provider 只枚举该根目录的直接子项：目录项需有 `<skill-dir>/SKILL.md`，或根目录直接包含 `.md` 文件。它不会递归寻找任意深度的 `SKILL.md`；指错到仓库根、`references/` 等目录时，技能可能不被发现。
- `SKILL.md` 必须有可解析的 YAML frontmatter，且至少包含 provider 要求的 `name`、`description`。缺字段、YAML 格式错误或不符合 DSH skill name 规则的文件会被跳过，而不是作为普通文本加载。
- `name` 是运行时 skill 身份，不是展示标题。catalog 的 `name` 必须与 frontmatter `name` 完全一致；目录名也建议与该名称一致，便于从路径直接核对。发现文件但名字不一致时，catalog 过滤会把它隐藏。
- 不要为了运行时方便直接改上游 `SKILL.md`。当前方案保留独立上游快照，由 Capital 自己的 catalog 选择暴露哪些名称；确实需要本地改写时，在 `UPSTREAM.md` 明确记录。

### Catalog 与隔离边界

- 每个可选 skill 在 `selected-skills/catalog.js` 有独立条目。`key` 是 Capital 设置使用的稳定键，`repository` 对应快照目录名，`name` 对应上游 skill frontmatter。多个项目可有同名 skill，接入前需避免 catalog 身份冲突。
- provider 明确关闭 DSH 默认 skill roots，只扫描配置的快照目录；否则用户或项目目录中的其他 skills 可能进入同一来源。
- catalog 过滤必须同时覆盖 provider 的 `list()` 与 `get()`。只过滤列表不够：已有 candidate 仍可能被直接传给 `get()`，因此未启用或不在 catalog 的名字必须在读取内容时再次拒绝。
- selected-skills provider 只在新建的 Capital 根 Agent scope 内注册；子 Agent 和其他 preset 不注册。设置值在 Agent 创建时读取，因此切换设置不会改写已经创建的 Agent；新建 Capital 会话后才按新选择加载。
- 与 Capital 已有路由冲突的上游编排 skill 不应仅因为它和模块一起存在于快照中就进入 catalog。当前 China Stock Research 快照保留上游 orchestrator 作为来源材料，但 catalog 只列独立研究模块。
- 上游脚本随快照保留不等于它们会运行。intake/provider 路径只发现并读取 skill 文档，不执行上游脚本。

### 发布打包与回归

- 本地工作区能发现文件，不代表发布包含有它。`package.json` 的 `files` 按仓库逐个登记（`selected-skills/catalog.js`、同级 `README.md`，加上每颗 `selected-skills/<repository>`）；新接一份快照忘了登记时 catalog 仍可能有条目，但用户启用后找不到对应 `SKILL.md`。
- 更新 catalog 时，确认每一条 `repository` / `name` 都能对应到 `selected-skills/<repository>/skills/<name>/SKILL.md`，并确认该项目的 `LICENSE` 与 `UPSTREAM.md` 随包发布。通过 npm pack 文件清单验证，不要只依赖仓库目录存在。
- 随包发的是运行时正文与溯源（`skills/` + `LICENSE` + `UPSTREAM.md`），不是上游仓库的全部：上游 README 用的成图与它自己的 viz 站点由 `selected-skills/investment-skills/.npmignore` 排除（2.3 MB，`images/` 与 `viz/out/` 还是同一批 PNG 的两份拷贝，skill 正文零引用）。全量快照完整住在 git，`github:` 安装与"当时是哪个 commit"的复核都不受影响；放宽这条排除口径要同步该项目的 `UPSTREAM.md` Packaging 一行与 `test/packaging.test.mjs` 的反向断言。
- 回归重点在 `test/selected-skills-provider.test.mjs`（默认关闭、root/preset 限定、list/get 过滤、scope 清理和新 Agent 读最新开关）、`test/persona.test.mjs`（skill frontmatter / preset 接线）及 `test/packaging.test.mjs`（发布包逐条查文件）。改动目录布局、catalog 字段或接入逻辑时同步这些断言。
