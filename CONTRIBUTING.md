# 贡献指南

这个仓库现在**只有一条对外开放的 PR 路径**：往 `selected-skills/` 提社区 Skill 快照。
其余部分（数据源、行情、图表、自选股、工具契约、宿主接线、第一方 skill 的正文）由维护者实现，
请先开 Issue 说明你遇到的问题，不要直接改——不是不欢迎，而是那些改动要与角色路由、权限边界和
一批回归断言同时成立，拆开两半反而谁都落不了地。

> **重要提示**
>
> 本项目是证券研究 Agent 插件，不提供投资建议或金融服务。Skill 必须中立、可验证、可追溯，
> 不得承诺收益、准确率或未来表现。

## 1. 为什么收录一条快照是安全的

一条 selected-skill 默认关闭，不改任何运行时行为：只有使用者在「插件」→ **Capital Generation**
→「精选 Skills」那一页里亲手打开对应的开关，它才会对**之后新建**的 Capital 会话可见；
子 Agent 不继承，上游脚本一律不执行。所以贡献一份好材料不需要说服维护者"这该默认启用"。

## 2. 你能提的三种 PR

| 类型 | 动什么 |
|---|---|
| 新快照 | `selected-skills/<repository>/` 整目录 + `catalog.js` 条目 + `package.json` 的 `files` 一行 + `THIRD_PARTY_NOTICES.md` 一行 |
| 已收录快照里多挑一条 skill | 只加 `catalog.js` 条目（文件已经在仓库里了） |
| 修文案与溯源 | `catalog.js` 的 zh/en 文案、能力标签、`lastCommit` / `reviewBy`，或 `UPSTREAM.md` 的维护记录 |

## 3. 硬门槛：任一项不过直接拒

底稿抄自[社区 Skill 引入与选用手册](docs/design/external-skill-intake.md)§3（那里有更细的判断口径与评分表）；
第 4–6 条是本仓按自己的运行边界加的——它们正是"必须改正文"的三条，所以放在硬门槛里而不是试用阶段。

1. **来源可核验**——能定位仓库、作者/维护者、固定 commit 或 release；转载包不收录。
2. **许可可用**——许可证明确，且允许原样快照与再分发。无许可或来源混杂时不要复制文本。
3. **权限可控**——不要求绕过宿主与插件已有的角色、工具、session、数据和网络边界；不得读取凭据、
   外传用户数据，或自动执行交易与账户操作。
4. **取数归属清楚**——正文**不得要求分析角色自己去联网或取数**。本插件取数只有一个入口：主 Agent
   委派 `data_collector`（结构化数据）与 `web_retriever`（网页、披露文件），根角色的出网工具是逐名移除的，
   bash 只给 `data_junior`。上游写给"什么工具都在手边"的宿主时，几乎总会带一句 `use web search`——
   **这类句子必须改掉**，改成"走宿主取数通道 / 把标的、字段、as-of 日期写进委派 brief"。
5. **不许用记忆回填数字**——比第 4 条更严重：`training-data estimates`、`Retrieval: model memory`、
   "打个 ⚠️ 警告然后继续"这类逃生口**没有任何工具会拦**，工具面拦得住越界取数，拦不住编造数字。
   一律改成"点名缺哪些字段、该字段下的分析停止"。
6. **不带执行面**——`python3 …` / `node …` / `install.sh` 这类指令要么删掉，要么同时写清
   "没有 shell 时直接读哪份附属文件"（脚本不进发布包，根角色也没有 shell）。
7. **可审查**——入口、依赖与实际行为可读。混淆代码、下载后执行、隐藏网络调用直接拒。
8. **金融表达可校验**——不承诺收益或准确率，不伪造引用，不把推断包装成事实，不以人格、玄学或
   单一回测结果代替证据。0–10 那一类打分要说明衡量的是自洽度/结构特征，不是预测表现；
   给仓位或买卖动作的段落要在 `riskNote` 写明是推演练习（本项目不提供投资建议）。
9. **可适配**——至少能拆成一个有边界的分析视角、工作流或验证步骤，说清输入、输出与失败时行为。
   只有泛化口号、或整套提示词无法拆解的不入驻。

第 4–6 条是**改正文的理由**（见 §5）：逐条对着 `selected-skills/<快照>/SKILL.md` 扫一遍再答，
`test/selected-skills-content.test.mjs` 会替你复查结果。完整清单（含出图/报告/编排排除、市场口径、
留痕与反证）在 `docs/dev/selected-skills.md` §8.6。

**维护频率不是硬门槛**，但必须记录：最近提交日期、近 90/180 天有意义的提交、下次复查日期。
长期静默的候选标 `watchlist`，仍可作为默认关闭的用户自选实验。Stars、forks、下载量不计入任何判断。

## 4. 一个 PR 要动的文件

```text
selected-skills/<repository>/
├── skills/<skill-name>/SKILL.md      # 运行时真正被读的东西（含 references/ 等附属文件）
├── UPSTREAM.md                       # 仓库 URL、owner、commit、许可、维护状态、本地改动
├── LICENSE                           # 上游原件，不许改写
└── .npmignore                        # 可选：快照里带大体积非运行内容时用它挡在包外
selected-skills/catalog.js            # 加条目
package.json                          # files 里加一行 "selected-skills/<repository>"
THIRD_PARTY_NOTICES.md                # 加一行署名（项目、作者、许可、原始仓库）
```

`catalog.js` 一条的字段与各自作用：

| 字段 | 作用 |
|---|---|
| `key` | 设置里那颗开关的稳定标识。**改名等于把使用者已开启的状态清掉** |
| `name` | 必须**等于** `skills/` 下那个目录名，provider 按它注册；对不上就是"勾了没反应" |
| `label` / `description` | 卡片显示的技能名与一句话简述，**zh 与 en 两套都要给** |
| `owner` / `repository` | 拼上游仓库链接；`repository` 同时是快照的目录名 |
| `tags` | 能力标签。只能用 `SELECTED_SKILL_TAG_LABELS` 里已有的键；要加新标签就**同时补 zh 与 en 两套显示名**，否则筛选条会直接露出英文原词 |
| `status` | `experimental` 或 `watchlist` 二选一，没有第三种 |
| `lastCommit` / `reviewBy` / `riskNote` | 复查用的运营记录 |

`status`、`lastCommit`、`reviewBy`、`riskNote` 目前**不在设置页显示**——它们是给维护者和扫描记录用的
成熟度信号。别在 PR 里为了"让用户看到风险"去改卡片渲染，那属于第 5 节之外的事，先开 Issue 讨论。

## 5. 不许做的事

- **无由由改上游正文。**改写只有两类理由：§3 第 4–6 条（取数归属、记忆回填、执行面）与运行时
  可发现性（frontmatter 补 `name`）。不为口味改措辞、不改目录名、不改分析结论；每一类改动
  逐条写进该快照的 `UPSTREAM.md`（改了哪一类句子、为什么、影响几颗）。**不进 catalog 的正文一律不动**——
  它们只是留在快照里的材料，改它们是纯粹的分歧成本。
- 把上游项目的 Agent 架构、系统提示词、工具权限或默认行为当成 skill 一起带进来。
- 让 catalog 收录会接管会话路由的编排型 skill（本插件的角色分流是单点决策，
  `china-stock-research-orchestrator` 就是因此被排除的）；同理排除教 Agent 自己出图的
  （出图只走 `render_chart`）与产出报告文件的（报告链路已删除且禁止恢复）。
- 引入可执行面：provider 只读 `SKILL.md` 与其附属文件，上游脚本作为材料保留、不执行。
- 提交 API Key、密码、用户会话、未脱敏材料、绝对路径，或许可不允许复制的上游全文。
- 为了让 CI 变绿而删断言、放宽权限或改动无关模块的测试。

## 6. 本地验证

当前适配 `@0.2.0-rc.2`，需要此版本或更新的 DSH 宿主。跑下面这组命令前先确认宿主版本，
版本不匹配时 `check:dsh` 与 `smoke:boot` 报的是扩展面差异，不是你的快照有问题。

```bash
npm install
npm run build
npm test
npm run check:dsh
npm run smoke:boot
```

`npm test` 里几条会直接指到你漏了哪一处：

- `test/selected-skills-content.test.mjs` 扫**你提的每一颗 skill 正文**：还在要求 Agent 自己取数、
  留了记忆回填的逃生口、带着脚本指令却没有"没 shell 时读哪份文件"的退路、或出处块的 `Retrieval:`
  没有委派档——都会点名到哪一颗、哪一句、该改成什么。扫描面按 catalog 现算，加一条就扫一条。
- `test/packaging.test.mjs` 从 catalog 反查发布清单：每条 `repository` + `name` 都要在包里落到真实
  `SKILL.md`，两份 `LICENSE` 与 `UPSTREAM.md` 必须随包发；`files` 里漏登记会在 `test/persona.test.mjs`
  就点名缺哪颗仓库。
- `test/persona.test.mjs` 钉 `status` 词表与"每条都必须带能力标签"，也钉 orchestrator 不进 catalog，
  以及 catalog 的 `key` / `name` 全局唯一与 frontmatter `name` 与目录一致。
- `test/capital-config.test.mjs` 钉 zh/en 标签显示名齐平——新标签只写一种语言会红在这里。

真机看一次最有价值：把插件装成你自己的 fork，新建 Capital 会话，在「配置」里只开你提的那一颗，
问一个它该管的问题，确认它被用上、且没改变其他行为。

```bash
dsh plugin --profile web add github:<你的用户名>/<仓库>
```

## 7. 提交流程

新快照建议先开 Issue，把候选登记卡的要点贴上来（上游 URL、固定 commit、许可证、你想填的缺口、
与现有 skill 的重叠），省得双方都在猜。文案与溯源修正可以直接开 PR。

```bash
git checkout -b skill/<short-name>
```

提交信息用 `feat(selected-skills): ...`、`fix(selected-skills): ...`、`docs(selected-skills): ...`。

PR 描述请回答：

- 这份材料填的是哪个缺口？使用者在什么任务里会去勾它？
- 上游 URL、你固定的 commit、许可证，以及有没有本地改动。
- **取数与合规逐条回答（§3 第 4–6 条）**：正文里谁去取数、有没有 `use web search` 一类句子、
  取不到时是报缺还是"用记忆估一个"、有没有 `python3` / `node` 脚本指令——原文是什么、你改成了什么。
  没有也要写"没有"。
- 脚本、网络、文件、凭据与 shell 行为你读到的是什么？（没有也要写"没有"）
- 与现有 skill 重叠在哪、比它多给了什么。
- 你判断 `experimental` 还是 `watchlist`，依据是最近提交与维护状态。
- 声称适用于 A 股的话，制度口径、复权与回测偏差这些检查过哪几项、哪些没证据。
- 怎么撤回（默认就是撤回容易：不勾它就不存在）。

## 8. 合并之后

合并 ≠ 启用。它先进入默认关闭的 catalog，由使用者自选；`status` 与复查周期由维护者定，
每季度复审上游、许可证与维护状态。发现许可风险、权限越界、重大误导或安全问题时，先标 `withdrawn`
禁止新会话使用，再评估已发布版本与用户影响——已发布内容不静默替换，修复要产生新版本。

## 9. 其他情况怎么提

- **数据不对、行情缺、图表或自选股有问题、Agent 行为不对**：开 Issue，写清代码、日期、你看到的与
  期望的。这类由维护者改，你的 Issue 就是改动的依据。
- **上游数据服务挂了**：不用你盯。仓库在北京时间周一到周六的早上跑一次数据源契约巡检（周六是全量），
  结构级失败会自动开一张带连续失败天数的 Issue。
- **安全问题**：不要公开贴复现细节、凭据或用户数据。开一张只描述影响面的 Issue，维护者会转私下沟通。

---

**License:** MIT
**Maintainer:** [Shawn](https://github.com/v587d)
