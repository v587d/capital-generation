# 精选 Skill 索引：任务型内置 skill ↔ 外部精选 skill

> 索引见仓库根 `AGENTS.md` §8。本文记录**能力标签注册表**（三轴 + `serves` + `fallback`）、任务型
> 内置 skill 在**读取期**拼索引的机制、编辑期上限与四条闸门。标签怎么入场、快照怎么接见
> `docs/dev/selected-skills.md` §8.6；角色边界与「不许改」全表见 `docs/dev/preset-persona.md` §8.1–§8.5。

## 8.7 索引机制与标签注册表

**要让主 Agent 在适当时候加载精选 skill，靠的不是把 68 颗塞进 persona，而是把"这次任务相关的
那几条"送到它在读的那颗任务型 skill 里。** 三颗任务型内置 skill（`capital-equity-research` /
`capital-event-impact` / `capital-portfolio-review`）的正文在读取期被拼上一段索引；磁盘上的
`SKILL.md` 一个字节都不动。

### 标签注册表：一处登记，两处生效

`selected-skills/catalog.js` 的 `SELECTED_SKILL_TAGS` 是**唯一来源**：条目的 `tags` 既决定设置卡片
左侧筛选条怎么分类它，也决定它进哪几颗任务型 skill 的索引。卡片的标签词表
（`SELECTED_SKILL_TAG_LABELS`）由注册表现算派生，导出形状不变。

三轴判据（`SELECTED_SKILL_TAG_AXES`）：

| 轴 | 判据 | 路由 |
|---|---|---|
| `market` | 什么市场口径（A 股 / 美股 / 将来的港股…） | **不路由**，只做标注 |
| `capability` | 调用什么分析方法（估值 / 财务健康 / 证据核验…） | 路由 |
| `topic` | 落在什么场景或对象上（组合、监控、税务…） | 路由 |

市场轴**不路由**是实测纠错的结果：最初写成"对所有任务型 skill 生效"，于是 10 个启用项（9 颗带
`a-share`）在三颗任务型 skill 里得到**完全相同**的清单，索引等于失效。判据是"是 A 股"不蕴含
"服务单股研究 / 事件影响 / 组合复盘"。改成不路由后，`10k-digest`（美股 10-K 深读）只进 equity 与
event-impact，`tax-lens` 只进 portfolio。**顺带白拿一个自动化**：新增市场口径标签零决策——不写
`serves`、不重跑任何分配，只登记一行（zh / en / axis）。

路由轴的 `serves`（可重叠）与 `fallback` **二选一**，两者都不给就是孤儿，闸门会红。

### 兜底：一切兜底都往 equity 装

一条 `serves` 都挂不上的条目，只在 `capital-equity-research` 的索引里出现（`SELECTED_SKILL_FALLBACK_TASK`）。
当前兜底名单必须为空（`fallbackOnlySkillNames()`），闸门钉住它：多出来一条就点名。

### 读取期拼装：遮蔽候选，不改磁盘

provider（`src/agents/selected-skills-provider.ts`）在 `list()` 里多做一件事：**只为"确实有索引可给"
的任务型 skill** 列出一个同名候选（rank 150 < 自定义根 `CUSTOM_RANK = 300`），`get()` 返回
「磁盘正文 + 索引块」。三条边界：

- **不改磁盘**：装好的包常常整棵只读；`skill-filesystem` 的 watcher 会被写文件搅动，多会话并行时
  互相打架；`test/persona.test.mjs` 正钉着那些文件的 frontmatter 与体积。
- **fail-open**：读不到底稿、或算下来索引为空，就**不列这个候选**——让给 fs provider 的原文。
  遮蔽是加法不是替换，"没有索引"永远不许演变成"这颗 skill 不见了"（§9.7 ⑤）。
- **一行都不启用时不遮蔽**：默认态与没有这个 provider 时逐字相同。

跨层不是靠 rank：preset 的 standing scope 是 **agent scope 的 parent**
（`dsh-agent-preset-registry` 的 `standingKey = scopeParentOf(agentKey)`），而 `chainLayers` 逐层
`merged.set(name, …)`、最近的一层最后落子。两条机制取其一即可——取两条是因为遮蔽失败的症状是
"索引静默消失"，没有第二个人会发现。

### 索引块的框（写在块内，不写在别处）

它把**外部方法论**塞进了**宿主契约 skill** 的正文，框架被拉平了，所以那四句必须随块同行：
这些是方法论材料、按需 `skill` 加载、**不改变**本 skill 的证据门 / 工具委派 / 输出通道、**冲突以
本 skill 为准**、只给摘要不等于全文。索引行用**运行时描述**（上游 frontmatter，与会话目录同源），
不用设置卡片里策展过的中文摘要——同一个 skill 在同一段上下文里出现两种描述只会让人两处对照。

### 编辑期上限：6 个（只挡"再勾一个"）

**为什么是 6，以及为什么不要抬**：三颗任务型内置 skill 的正文与这段索引块在**同一次 `skill` 结果**
里，剪枝闸门 `thresholdChars: 8192`（保留 head 4096 + tail 1024）——超过就是**中间静默消失**，
症状与 §9.7 那一族相同（没人报错）。索引每行带运行时 description，几十到几百字符一行；
"三颗任务型 × 每颗至少 2 条"是这条字节预算允许的算术，不是口味值。往内置正文加句子花的是
同一份预算，判据见 `docs/dev/preset-persona.md` §8.2 那条分界。

`SELECTED_SKILLS_MAX_ENABLED = 6`，只在设置卡片生效：到上限后未勾的开关置灰，原因挂在**该行开关
左侧**的一枚三角警示图标上（官方三角 + 感叹号）——悬停 `title` 与读屏 `aria-label` 同一串
`Skill已达上限 (n/6)。`，列表顶上不留汇总提示、开关上不挂 `title`；文案住字典、`(n/6)` 由代码拼
（`{count}` 占位），字典不存数字。**已勾上的行永远关得掉**。老配置多于 6 个照常全部生效并提示
收敛——运行期 provider **不按这个数截断**，否则症状就是"卡片上开着 10 个、会话里只剩 6 个"。6 是
"三颗任务型 × 每颗至少 2 条"的算术，紧；想要跨市场冗余就用 8，但那个数字只改这一处常量。图标 /
位置 / 文案形状由 `test/capital-config.test.mjs` 钉。

### 闸门与重跑清单

四条闸门住 `test/selected-skill-tags.test.mjs`（登记完整性 / `serves` 拼写 / 反向可达 / 上限不变量），
卡片那一半住 `test/capital-config.test.mjs`，遮蔽与拼装住 `test/selected-skills-provider.test.mjs`。

| 新增什么 | 要做什么 | 重跑 |
|---|---|---|
| 外部精选 skill | 入场填 `tags`；带新标签时同时登记 axis 与 `serves` | 不用（派生自动生效） |
| 新标签（market 轴） | 词表加一行，零决策 | 不用 |
| 新标签（routing 轴） | 词表加一行 + `serves` 或 `fallback` | 一次 sweep |
| 新任务型内置 skill | 划 `serves` 并重查反向可达 | **必须重跑** |
| 新轴 | `SELECTED_SKILL_TAG_AXES` 加一行 | 一次 sweep |

### 已知边界

遮蔽是否在真 boot graph 里赢下同名合并，本轮**只**用单测 + 框架源码（scope parent 与 `chainLayers`
的最近层语义）验证过，没有加进 `smoke-boot.mjs` 的探针（那需要在探针里真建一个带启用项的 Agent）。
第一次用它时若发现索引没出现，先查这一条。

**精选条目自身的可见上限**：条目正文同样过一次 `thresholdChars: 8192` 的剪枝器（`skill` 的渲染包装
另占约 512），所以一颗 3 万字符的 skill 被勾选后，使用者拿到的是 head 4096 + tail 1024。剪枝器在中段留
`[... tool result middle pruned ...]`（`dsh-compaction-tool-result-pruner` 的 `PRUNE_MARKER`）——
**模型看得见这一句，使用者看不见**，所以症状仍是"没人报错"。2026-10-14 按 catalog 现算：68 颗可加载
条目里正文超这条线的一度是 **32 颗**（最大 `stock-eval` 31,754，可见不足 16%），全部来自上游快照；
分层两批做尽 32 颗（2026-10-14 七颗 + 2026-10-15 二十五颗），记名基线 `OVERSIZED_BASELINE` 已清空。
闸门「外部精选正文的体积棘轮」（`test/persona.test.mjs`）因此从"别再加新的超限条目"**升级成硬闸门**：
任何 catalog 条目正文超过可见上限就红。处置走**可见性分层**——把正文切成「入口册 + 分册」，
分册由模型用 `read` 按需打开（实测：`read` 在宿主工具层挂载、根角色未被 deny，且工作区外的绝对路径可读；
宿主回执本来就教它"Resolve relative paths against the base directory, load referenced resources only as needed"）。

⛔ **分层的上限不能按文件字符数定**。`read` 的回执是带行号的窗口（`formatReadOutput`：每行前缀
`N: `，外加 `<path>` / `<type>` / `<content>` 与结尾"total N lines"），实测 7,302 字符 / 95 行的正文
渲染成 7,894——**同一份文件走 `skill` 与走 `read` 占的字节不同，行越多差得越多**。所以两条通道各自的
上限是：`skill` 看正文 ≤ `threshold − 512`，`read` 看**渲染后** ≤ `threshold`。按字符数定的上限会放过
真会被剪的册子（反证：往一册里加 200 行空内容，文件字符仍在 7,680 内而 read 回执破 8,192，闸门红）。
建模只在 `test/selected-skills-content.test.mjs` 的 `readEnvelopeChars` 有一份。

台账是 `test/selected-skills-content.test.mjs` 的 `LAYERED`（32 颗，只准变长）。**第一批 7 颗**（2026-10-14）：`buffett-investment-framework`（入口 11,296 → 6,605；`references/` 9 → 22 份，65 张卡按卡片边界切）、三颗 A 股 `china-idea-generation` / `china-sector-overview` / `china-catalyst-calendar`（流程搬进一份分册，每册都带 Apache §4(b) 那行声明）、`bear-case` 与 `stock-screener`（各 3 册）、`peter-lynch-skill`——最后一颗是**两层厚正文**：入口之外上游自交的 4 份指南（8,750–21,342）也超限，各切成多册并把**原路径留成几百字符的索引**，这样十几处互指的旧指针一个都不用改。

**第二批 25 颗**（2026-10-15，全部是 InvestSkill 的单文件厚册，15,437–31,754 字符）用同一套工序批量重排：入口只留**每轮都成立的那三节**（`⚠️ Data Verification` / `📋 Data & Sources Header` / 有的话 `⚠️ Read This First`）+ 一列分册名 + 那两句反谎报硬话，其余按 `##` **保序**搬进 `references/10…`，单节渲染破上限就依次降级到 `###` / `####` / 空行段落。三条实测结论：① 分册抬头那 4 行也要进 `read` 包络，宁可按 500 字符预留多切一册，也不许事后剪尾凑数（凑数=删内容）；② 一节被切到下一册时**册末自动留一句"This section is not finished here: … continues in `references/NN-….md`"**，所以 `following sections` 这类回指不会落到空气上——第二批 25 颗只查到 1 处真断链（`learning-coach` 的 "the quiz block from §4"，改成点名那一册），远低于第一批的 5 处；③ 闸门的断链判据只认**裸文件名或以 `references/` 打头**的路径：上游正文里也写 `.md`，但那是产物名模板（`<TICKER>-10k-digest.md`）或输出目录示例（`output/thesis/NVDA.md`），当断链就是假阳性（两颗各撞一种）。逐行核对：两批都零行丢失，只有改写的分派指针例外。

⛔ **分层引入的唯一新失效面：模型会不会真去开分册。** 真机样本（2026-10-14 新会话）里它只加载了入口册，却回答"已经读入全文了"，并把入口里那段 router 当成可选项兜售给使用者——摘要每一条都逐字来自入口册，只在分册里的卡片正文、workflow 步骤、输出契约一项没提。所以每一颗分层的入口都写着两句话：**加载入口不等于读过本 skill**，以及说清哪些册开过、哪些没开，没读过的步骤/阈值/模板一律不得转述。router 那段执行示例也照 §8.6 第 4 条从入口搬走了。这条只能真机复验，闸门管不到"它去不去读"；第二批 25 颗用的是同一套入口话术，开一次真机会话即可同时覆盖两批（2026-10-15 尚未复验）。
