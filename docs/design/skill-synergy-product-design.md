# Skill Synergy 产品设计说明书

**文档状态：**目标产品设计稿
**适用项目：**Capital Generation / DeepSeek Harness（DSH）
**原称：**Skill Tree（本稿不再把产品定义为树形节点目录）
**目标版本：**Skill Synergy v1.0

## 1. 产品摘要

Skill Synergy 是面向 Agent 的能力协同框架。它不只是一个 skill 目录，也不是把 skill 简单挂到主 / 子 Agent 上，而是规定：面对一个任务，应该如何组合不同性质的 skill、工具、脚本、数据来源、分析视角、校验器和本地经验，让 Agent 形成可复用、可验证、可持续演进的工作能力。

这里的“工具使用规则”必须覆盖两类内容：

- 当前仓库和 DSH 中真实存在的工具调用，包括工具名、参数契约、角色权限、数据边界、失败处理和回传格式。
- Skill 包内 `scripts/**/*.ts`、`scripts/**/*.py` 等脚本中实现的工具调用编排、数据转换和验证逻辑。脚本不是隐藏实现；它们属于 Skill 的可审查、可测试、可版本化能力面。

Skill 的核心能力：

1. **框架化协同：**通过抽象框架描述 skill 之间怎样互补、依赖、替代和校验，而不是只维护一棵具体技能树。
2. **角色化装配：**同一 skill 可以分别服务主 Agent、子 Agent、verifier 或工具脚本，但每种绑定都必须声明边界。
3. **轮次级组合：**同一个 session 的不同轮次可以使用不同 Skill Composition；一个轮次一旦开始，组合快照不可修改。
4. **可自进化：**基础 Skill Release 保持可追溯，用户在本地积累场景经验和 gotcha，形成仅对自己生效的本地 overlay，并可在用户同意后沉淀为新的候选版本或 PR。
5. **Owner 主导、Contributor 辅助：**项目 Owner 负责定义框架、质量标准、核心 skill 和外部项目引入；Contributor 在框架约束下补充实现、案例和验证。

最终目标是充分发挥现有主 / 子 Agent 能力，为同一问题提供互补而非重复的多维视角，并让每个结论都能追溯到使用的 skill、工具、脚本、数据和本地经验。

## 2. 背景与现状

### 2.1 当前基础

仓库已经具备 Skill Synergy 的运行基础：

| 现有能力 | 当前实现 | 对 Skill Synergy 的价值 |
|---|---|---|
| 预设装配 | `preset/capital-generation/agent.patch.yml` 的官方 `dsh-agent-preset` 声明 | 提供稳定的主 / 子 Agent 组合入口 |
| Skill 加载 | `dsh-skill-filesystem` + `dsh-tool-skill` | 提供 `SKILL.md` 按需加载机制 |
| 角色编排 | `dsh-subagent` 专用委派行 | 将不同 skill 绑定到明确角色 |
| 工具权限 | `toolFilter.allow/deny` 与根 Agent 收敛策略 | 防止 skill 把协议能力误变成工具权限 |
| 数据边界 | Dataset / profile / chart opaque ref | 支持只传引用、不传原始 rows |
| 现有协议 | `capital-orchestration`、`capital-data-protocol`、`capital-web-protocol`、`capital-visualization-protocol`、`capital-chart-protocol` | 提供第一批可复用的协同规则 |
| 脚本与工具 | `src/`、`scripts/` 及未来 Skill 包内 `scripts/**/*.ts|py` | 承载真实工具调用和确定性处理，不应被 SKILL.md 遮蔽 |

### 2.2 当前缺口

- 当前 skill 主要是随 preset 分发的协议文件，缺少“协同框架”这一层抽象。
- 没有统一记录一个 skill 需要哪些工具、脚本入口、输入输出契约、角色和安全边界。
- “可版本化”已经有基础，但缺少“使用后如何积累场景经验并自进化”的产品闭环。
- session 与轮次的关系不清晰，容易把“同一 session 可换组合”误解为“运行中热修改”。
- 项目贡献规则仍是通用插件贡献指南，没有体现 Owner 主导、Contributor 辅助的 Skill Synergy 治理关系。
- 缺少由 Owner 定期发现、评估、适配成熟开源 skill 项目的方法。
- 多维视角缺少统一的框架位置、证据契约和去重规则。

### 2.3 产品边界

本次设计只处理 Skill Synergy 相关内容：skill 文档、manifest、skill 内脚本、工具调用规则、本地 gotcha、组合快照、Owner / Contributor 治理和相关测试。

本次不改造数据源、图表、行情、OCR、watchlist、普通 Agent 工具、宿主 session 实现或其他业务模块。它们只作为 Skill Synergy 需要引用的既有能力，不在本产品范围内重新设计。

Skill Synergy 复用 DSH 的官方 preset、skill loader、tools、session 和 subagent 服务，不在插件内另造平行 Agent registry，也不通过隐式目录扫描绕过宿主装配。

### 2.4 `CONTRIBUTING.md` 重构方向

现有 `CONTRIBUTING.md` 是面向整个插件的通用贡献指南，列出了数据能力、可视化、子 Agent 和架构等多种贡献类型。Skill Synergy 阶段需要把它重构为 **Skill Synergy 贡献与治理入口**，而不是仅在原指南末尾追加一节 skill 贡献。

重构后的指南必须：

1. 明确 Owner 是框架、核心 skill、默认组合、外部引入和最终合并的责任人。
2. 明确 Contributor 是框架内的扩展者，不能通过一个 skill PR 改变其他模块的架构边界。
3. 将贡献对象限定为 skill manifest、`SKILL.md`、skill 内 `scripts/**/*.ts|py`、测试、案例、gotcha 提案和相关文档。
4. 将数据源、图表、watchlist、普通工具、宿主适配和其他业务模块从本阶段贡献入口中排除；需要这些模块的改动必须另开议题，不混入 Skill Synergy PR。
5. 规定 Owner 如何定期寻找优秀开源 skill 项目、完成 provenance 和适配评估，再决定是否进入官方组合。
6. 规定本地自进化记录如何脱敏、如何由用户主动提升为候选 gotcha 或 PR，不能自动上传或自动改变官方 skill。

## 3. 产品目标与非目标

### 3.1 目标

| 编号 | 目标 | 衡量结果 |
|---|---|---|
| G1 | 抽象协同框架 | 任一 skill 都能说明它位于框架哪一环、依赖谁、为谁提供什么 |
| G2 | 工具调用透明 | 工具和 `*.ts` / `*.py` 脚本的入口、权限、输入输出和失败行为可审查 |
| G3 | 主 / 子 Agent 协同 | 每个角色获得最小充分的 skill 组合，既能复用又不越权 |
| G4 | 轮次级组合 | 同一 session 不同轮次可以使用不同组合，运行中的轮次不发生 skill 修改 |
| G5 | 本地自进化 | 用户 gotcha 可本地记录、复用、版本化，并由用户决定是否贡献给 Owner |
| G6 | Owner 运营框架 | Owner 能持续定义框架、发现外部优秀项目、适配、验证和发布 |
| G7 | 社区可参与 | Contributor 能在框架约束下提交、测试、评审和合并 skill 贡献 |
| G8 | 多维证据 | 同一问题形成互补视角，结果包含证据、冲突、局限和下一步 |

### 3.2 非目标

- 第一阶段不实现任意第三方代码在宿主进程内自由执行。
- 不在一个轮次运行中热插拔、删除、替换或重载 skill。
- 不让 skill 修改系统 policy、角色边界、工具权限或数据隔离。
- 不把社区热度、skill 数量或提示词长度作为能力质量的唯一指标。
- 不自动把用户本地 gotcha 上传、合并为官方 skill 或覆盖其他用户的 skill。
- 不在本次 session 改造数据源、图表、watchlist、普通工具和其他业务模块。

## 4. 用户与参与者：Owner 主导模型

### 4.1 Owner 的核心职责

Skill Synergy 一定以项目 Owner 为主、Contributor 为辅。Owner 不是普通 maintainer，而是框架的设计者和最终责任人，负责以下不可委托或不可隐式转移的事项：

- 定义 Skill Synergy Framework 的抽象维度、命名、组合约束和质量门槛。
- 维护官方 skill、默认 Composition、核心 policy 和主 / 子 Agent 边界。
- 建立“能力缺口 -> 外部项目搜寻 -> 适配 -> 评估 -> 官方收录”的周期机制。
- 审核成熟项目的许可证、来源、行为和与现有框架的兼容性。
- 决定 Contributor 的提案是否进入 canonical skill、实验通道或仅保留为社区实现。
- 审核涉及工具调用、脚本执行、数据访问、网络和安全边界的变更。
- 维护质量基准、评测样例、回滚策略和发布节奏。

### 4.2 Contributor 的角色

Contributor 不负责重新定义框架；其主要职责是在 Owner 定义的框架槽位中提供：

- 新的场景实现、视角实现和 verifier。
- 对既有 skill 的脚本适配、工具调用修复和测试补充。
- 来自实际使用的脱敏 gotcha、边界案例和失败样本。
- 对成熟开源项目的适配建议和 provenance 信息。
- 文档、fixture、性能数据和反例。

Contributor 可以挑战框架，但应先提交设计议题；未经 Owner 批准，不能在普通 skill PR 中改变框架的核心维度或默认组合。

### 4.3 普通用户与 Agent

普通用户选择每轮 Composition、反馈结果、确认本地 gotcha 是否保存，并决定是否将 gotcha 脱敏后提交给 Owner。用户不需要理解完整框架才能使用 skill。

Agent 负责按当前轮次的 Composition 执行。主 Agent 负责任务澄清、组合建议、角色路由和综合；子 Agent 负责自己的视角、工具和脚本范围。Agent 只能提出下一轮的组合建议，不能在当前轮修改 Composition。

### 4.4 Owner 如何建立框架

Owner 先回答“任何优秀 skill 进入项目时，必须被放入哪些抽象位置”，而不是先罗列具体 skill 名称。框架至少包含以下维度：

```text
任务意图 / Context
        |
角色与协同边界
        |
Perspective Lens
        |
证据与输入
        |
推理 / 工作流
        |
工具调用与脚本入口
        |
校验 / 反方 / 失败处理
        |
输出契约与交付
        |
本地经验与自进化
        |
治理、来源、版本与权限
```

任何官方或社区 skill 都必须说明自己填补哪个维度、与哪些维度协同、哪些事情明确不负责。具体 skill 是框架的实例，不是框架本身。

### 4.5 Owner 的周期运营

建议 Owner 按月做轻量扫描、按季度做一次框架评估：

1. 汇总用户任务失败、重复调用、数据缺口、gotcha 聚类和 Contributor 提案。
2. 映射为框架缺口，例如缺少某种 verifier、脚本适配器、视角或输出契约。
3. 根据缺口检索 GitHub、论文实现、成熟 Agent 项目和相关工具生态。
4. 对候选项目做活跃度、许可证、维护者、测试、真实行为和提示注入评估。
5. 用适配层接入候选项目，不直接复制其默认 Agent 架构。
6. 使用固定 benchmark 与现有 canonical skill 对比，记录增益、成本和回归。
7. 决定进入 `official`、`adapted`、`experimental`、`community` 或拒绝。
8. 将结论、来源、版本和下一次复查时间写入 registry。

## 5. Skill Synergy Framework

### 5.1 框架不是 Skill Tree

旧的 Skill Tree 表达容易让人理解为一棵具体的技能分类树。Skill Synergy 更准确地表达“多个能力如何围绕任务共同产生价值”。产品界面可以使用树、矩阵、关系图或组合画布，但底层对象是框架维度、关系和 Composition，不是固定节点树。

Skill Synergy Framework 定义的是：

- **槽位（slot）：**一个 skill 可以贡献什么，例如 evidence、lens、tool adapter、verifier。
- **关系（relation）：**skill 之间是依赖、补充、替代、校验、前置、后置还是冲突。
- **边界（boundary）：**角色、工具、数据、网络、文件和副作用限制。
- **契约（contract）：**输入、输出、证据、错误和不确定性格式。
- **反馈（feedback）：**本地 gotcha、使用结果、失败样例和升级候选。

### 5.2 Framework Blueprint

Owner 维护一个抽象 Blueprint，而不是把具体公司、指标或分析方法硬编码进产品模型：

| 框架环节 | 要回答的问题 | 可挂载的 Skill 类型 |
|---|---|---|
| Intent / Context | 用户要解决什么问题，约束和截止是什么 | task framing、context resolver |
| Role / Collaboration | 谁执行，谁中继，谁只能读什么 | orchestration、role policy |
| Perspective Lens | 需要哪些互补观察角度 | fundamental、technical、risk、counterfactual |
| Evidence | 哪些事实、来源和新鲜度是必需的 | data、retrieval、source verifier |
| Method | 如何分析、重试、收敛和停止 | workflow、reasoning protocol |
| Tool / Script | 调用哪些工具和 `*.ts` / `*.py` 入口 | tool adapter、script runner |
| Verification | 如何检查事实、口径、权限和失败 | verifier、quality gate |
| Delivery | 如何组织结果、图表、引用和局限 | presentation、report contract |
| Learning | 哪些 gotcha 可沉淀为本地经验 | gotcha capture、adaptation |
| Governance | 来源、许可证、版本、权限和审批 | provenance、policy |

### 5.3 Skill 类型是框架角色

Skill 类型不是一个封闭的具体技能清单，而是对 Blueprint 的角色分类：

| 类型 | 在框架中的位置 | 典型责任 |
|---|---|---|
| `policy` | Governance / Boundary | 安全、合规、权限硬规则 |
| `protocol` | Contract | 消息、字段、错误、回传格式 |
| `workflow` | Method / Collaboration | 任务拆解、路由、重试、停止 |
| `perspective` | Perspective Lens | 从一种角度产生可验证观察 |
| `evidence` | Evidence | 获取、标注、分级和组织事实 |
| `tool-adapter` | Tool / Script | 既有工具和脚本的安全调用规则 |
| `verifier` | Verification | 事实、来源、数据口径和输出校验 |
| `presentation` | Delivery | 表格、图表、报告结构 |
| `learning` | Learning | gotcha 捕获、局部适应和候选升级 |

一个 skill 可以同时承担多个类型，但必须分别声明每种责任，禁止用一个笼统描述掩盖权限或行为。

## 6. Skill 内容、工具和脚本模型

### 6.1 Skill Release 目录

```text
skill/<skill-id>/
├── SKILL.md                    # 模型按需加载的协议和协同规则
├── skill.yaml                  # 机器可读 manifest
├── scripts/
│   ├── *.ts                    # TypeScript 工具调用 / 确定性处理
│   └── *.py                    # Python 工具调用 / 分析 / 验证脚本
├── tests/
│   ├── fixtures/               # 正常、边界、失败和权限样例
│   ├── contract.test.yaml      # 输入输出契约
│   ├── tool-call.test.yaml     # 工具 / 脚本调用契约
│   └── safety.test.yaml        # 注入、路径、凭据和数据边界
├── examples/                   # 脱敏案例
├── LICENSE
└── provenance.json              # 来源、改编和许可证证明
```

`SKILL.md` 负责模型可读的规则；`skill.yaml` 负责机器解析；`scripts/**/*.ts|py` 负责确定性执行或受控工具调用。脚本必须被列入 manifest、测试和权限审查，不能成为隐藏的 shell 通道。

### 6.2 工具与脚本调用契约

每个工具或脚本入口至少声明：

- `entrypoint`：工具名或脚本路径，不允许动态拼接未知入口。
- `callerRoles`：哪些 Agent 角色可以调用。
- `inputSchema` / `outputSchema`：参数和结果契约。
- `requiredTools`：脚本内部允许使用的工具集合。
- `dataAccess`：是否读 Dataset、profile、workspace 或外部来源。
- `network` / `secrets` / `filesystem`：权限等级和具体范围。
- `failureModes`：错误码、重试次数、停止条件和用户可见信息。
- `determinism`：纯计算、依赖外部数据或含随机性。
- `budget`：时间、token、调用次数和并发上限。

Skill 只声明和编排能力，不自动提升宿主 `toolFilter`。脚本的最终权限仍是 skill、角色、session policy 和 host policy 的交集。

### 6.3 Manifest 示例

```yaml
apiVersion: skill.capital-generation/v1
kind: Skill
metadata:
  id: finance.equity-research.risk
  version: 1.2.0
  name: Equity Risk Review
  owners: [owner:capital-generation]
  tags: [finance, risk, review]
spec:
  frameworkSlots: [perspective, evidence, verification, learning]
  compatibleRoles: [main, data_junior, verifier]
  requires: [finance.evidence.source-disclosure@^1.0.0]
  complements: [finance.perspective.fundamental]
  conflicts: [finance.perspective.buy-signal]
  tools: {required: [], optional: [describe_dataset, query_dataset]}
  scripts:
    - entrypoint: scripts/check-cashflow.ts
      callerRoles: [data_junior]
      requiredTools: [describe_dataset, query_dataset]
      network: none
      secrets: none
      workspace: read-only
  outputs:
    contract: evidence.risk.v1
  evolution:
    localGotchas: allowed
    autoUpload: false
    autoPublish: false
  provenance:
    sourceType: original
    license: MIT
```

### 6.4 可版本化与可自进化的区别

- **Skill Release：**Owner / Contributor 发布的可复现基线，具有 SemVer、digest、来源、测试和回滚能力。
- **Local Gotcha Overlay：**用户本地的场景经验，只作用于该用户和明确的 skill / context，不改变 Release digest。
- **Candidate Evolution：**由多个 gotcha 聚类并经过脱敏、测试后形成的候选变更，是否进入官方 Release 必须由用户主动提交并由 Owner 审核。

本地经验不能修改 policy、角色边界、工具 allow / deny、数据保留和安全规则；它只能补充场景判断、字段解释、失败处置或用户偏好，并受到长度、敏感信息和冲突检查限制。

## 7. Skill 自进化与 Gotcha 机制

### 7.1 生命周期

```text
使用 Skill Release
      |
      v
发现具体场景偏差 / 失败 / 更好做法
      |
      v
用户确认并记录 Local Gotcha
      |
      v
下一轮解析 Base Release + Local Overlay
      |
      v
重复场景聚类、脱敏、fixture 化
      |
      v
用户选择：仅本地保留 / 提交 Owner / 发起 Contributor PR
      |
      v
Owner 评估后形成 Candidate 或新 Release
```

### 7.2 Gotcha 数据模型

```json
{
  "gotchaId": "gotcha_01J...",
  "skillId": "finance.equity-research.risk",
  "baseVersion": "1.2.0",
  "scope": "user-local",
  "contextFingerprint": "equity-cashflow-quarterly",
  "trigger": "用户要求比较现金流质量时",
  "observedProblem": "某字段在该来源中代表累计值而非单季值",
  "recommendedAdjustment": "先确认 period_type，再进行同比比较",
  "evidenceRefs": ["profile_ref:pf_01J..."],
  "confidence": "medium",
  "status": "accepted|candidate|promoted|rejected",
  "createdAt": 1780000000000
}
```

不得默认保存原始用户问题、原始 rows、凭据、绝对路径和未脱敏网页正文。gotcha 应保存最小必要事实、opaque ref 或脱敏摘要。

### 7.3 本地存储和生效

Gotcha 存放在用户本地的 Skill Synergy 私有存储中，按 `user + skill_id + baseVersion + contextFingerprint` 隔离。它不进入 Git、不自动上传、不自动同步给其他用户。

每个轮次开始前，Resolver 读取已接受的本地 gotcha，生成该轮的 Skill Composition snapshot。轮次开始后：

- 当前 snapshot 不再修改。
- 新发现的经验只能进入“待确认 gotcha”队列。
- 用户在轮次结束或下一轮开始前确认，确认后才影响下一轮。
- gotcha 与基础 Release 的版本绑定；基础版本升级后重新评估兼容性，不能盲目套用。

### 7.4 自进化边界

Skill 可以根据 gotcha 改善场景识别、工具调用顺序、字段理解、输出措辞和验证提醒，但不能自行：

- 改写 system / policy 规则。
- 新增工具、网络、文件或凭据权限。
- 修改主 / 子 Agent 路由和生命周期。
- 把一次偶然反馈直接写成普遍事实。
- 自动将本地经验上传为公共 skill。

## 8. Composition 装配模型

### 8.1 Composition 是轮次对象

一次 `Skill Composition` 由以下输入解析得到：

```text
Framework Blueprint
  + preset baseline
  + user-selected skill set
  + agent role bindings
  + accepted local gotchas
  + task context
  + host policy and capabilities
```

输出至少包含：每个 Agent 的 skill / script 入口、依赖闭包、关系图、工具权限交集、数据边界、运行预算、gotcha 摘要、冲突 / 降级诊断和 `compositionDigest`。

### 8.2 关系类型

- `requires`：缺失不能运行。
- `complements`：共同使用可增加信息价值。
- `alternative`：同一框架槽位的替代实现。
- `verifies`：对另一个 skill 的结果进行校验。
- `precedes` / `follows`：调用顺序关系。
- `conflicts`：不能共同使用或必须用户选择。
- `learns-from`：允许 gotcha 反馈，但不共享权限。

解析器需要进行依赖闭包、冲突检测、工具交集、预算计算和关系去重；不能静默删掉用户选择的 skill。

### 8.3 主 / 子 Agent

主 Agent 默认负责 Intent、Role / Collaboration、综合和最终披露；`data_collector` 负责 Evidence；`data_junior` 负责 profile、统计和可视化 gate；`web_retriever` 负责外部来源；`visualization_specialist` 只消费受限 chart source；verifier 负责跨视角校验。

同一个 skill 可服务多个角色，但每个角色必须有独立 binding。主 Agent 不能因为启用了某个 perspective skill 就直接获得结构化取数、外部检索或出图工具。

## 9. 同一 Session 的轮次级 Skill 组合

### 9.1 核心语义

“同一个 session 可灵活使用 skill”定义为：session 是上下文容器，**每一轮可以选择不同的 Skill Composition；一次轮次运行后，Composition 不可修改**。

```text
Session S
  ├── Turn 1 -> Composition A -> immutable while running
  ├── Turn 2 -> Composition B -> immutable while running
  └── Turn 3 -> Composition C -> immutable while running
```

这不是运行时热插拔，也不是给正在执行的 Agent 做 live reload。旧轮次的 Agent、工具调用和子 Agent 使用启动时的 snapshot 完成。

### 9.2 轮次开始前

在轮次开始前，用户可以选择官方 bundle、自定义 skill 集、Perspective Lens、本地 gotcha 是否启用和必要的版本锁。主 Agent 可以根据任务提出建议，但需在轮次启动前完成确认。

Resolver 在启动前执行：

1. 读取 Framework Blueprint 和 preset baseline。
2. 合并用户选择、角色 binding、task context 和已接受的 local gotcha。
3. 解依赖、检查冲突、计算工具 / 脚本权限交集和预算。
4. 生成不可变 Composition snapshot 和 digest。
5. 将 snapshot 绑定到本轮主 Agent 及其创建的子 Agent。

### 9.3 轮次运行中

运行中禁止添加、删除、替换、升级、降级或重新加载 skill。若 Agent 发现需要新的视角或工具：

- 记录为 `next_turn_recommendation`。
- 如果确实缺少完成任务所需的能力，则暂停并向用户说明，等待下一轮重新选择。
- 不得偷偷使用未在 snapshot 中的 skill、脚本或工具。

轮次结束后可以生成 gotcha、组合评价和下一轮建议，但这些结果只能影响后续轮次。

### 9.4 轮次 API 语义

建议的逻辑接口是 `prepareTurnComposition`，而不是 runtime overlay：

```text
prepareTurnComposition(sessionId, turnId, selection)
  -> dryRun diagnostics
  -> user confirmation
  -> immutable composition snapshot
  -> start turn
```

```json
{
  "sessionId": "s_01J...",
  "turnId": "t_07...",
  "skills": [
    {"id": "finance.perspective.fundamental", "version": "1.4.0"},
    {"id": "finance.perspective.risk", "version": "1.2.0"}
  ],
  "localGotchas": "accepted-only",
  "compositionDigest": "sha256:..."
}
```

## 10. Perspective Lens 与多维视角

Perspective Lens 是 Framework Blueprint 的一个环节，不是 Skill Synergy 的全部，也不等价于 Skill Node。它用于说明同一任务需要从哪些互补角度观察，并规定每个角度的证据要求。

建议视角包括数据事实、基本面、技术面、消息面、宏观 / 行业、风险、反方 / 反事实、合规与表达。默认只选择最小充分集合，避免启用全部视角造成重复取数和成本膨胀。

### 10.1 工作流

```text
用户问题
  -> Intent / Context
  -> Perspective Lens 选择
  -> Framework 关系解析
  -> 轮次 Composition 固化
  -> list_agents 预检与角色复用
  -> 并行收集证据
  -> verifier 检查来源、时间、口径和冲突
  -> 主 Agent 综合并披露不确定性
  -> 轮次反馈、gotcha 和下一轮建议
```

### 10.2 统一证据契约

```json
{
  "task_id": "task_01J...",
  "perspective": "risk",
  "status": "completed|partial|blocked|failed",
  "claims": [{
    "claim": "现金流质量需要进一步核查",
    "evidence": ["profile_ref:pf_01J..."],
    "sourceLevel": "structured_data",
    "capturedAt": 1780000000000,
    "confidence": "medium",
    "limitations": ["缺少连续季度明细"]
  }],
  "contradictions": [],
  "dataGaps": [],
  "nextChecks": ["补充最近四个季度经营现金流"]
}
```

主 Agent 只合并 claims、evidence、limitations 和 contradictions，不把多个 Agent 的原始 rows 重新带入上下文。

## 11. Owner 发现和引入优秀开源 Skill

### 11.1 周期性搜寻

Owner 根据 Framework 缺口建立候选池，而不是按项目热度直接收录。候选来源包括成熟 Agent 项目、工具调用框架、领域分析库、验证器、研究论文实现和社区 PR。

每个候选项目记录：upstream URL、commit / release、维护活跃度、许可证、依赖、实际入口、工具和网络行为、测试质量、提示注入风险、与 Blueprint 的对应槽位、适配工作量和预期增益。

### 11.2 适配流程

```text
框架缺口
  -> 候选发现
  -> provenance / license / security due diligence
  -> 映射 Blueprint 槽位
  -> DSH adapter 和最小权限适配
  -> benchmark / regression / cost test
  -> Owner 决定官方、适配、实验、社区或拒绝
  -> 发布和定期复查
```

不得直接把外部项目的 Agent 架构、权限或系统提示词整体复制进来。引入的是经过审查的能力和适配层。

### 11.3 来源等级

| 等级 | 含义 | 是否默认启用 |
|---|---|---:|
| `official` | Owner 维护的核心 framework / skill | 可 |
| `adapted` | 已完成外部项目适配和审核 | 否，Owner 决定 |
| `experimental` | Owner 或 Contributor 的待验证实现 | 否 |
| `community` | 仅通过基础检查的社区贡献 | 否，用户显式选择 |
| `withdrawn` | 被撤回或不再允许新轮次使用 | 不可 |

## 12. CONTRIBUTING.md 与社区协作

### 12.1 Owner 主导的贡献流程

```text
Owner 发布框架 / 缺口
  -> Contributor 选择框架槽位
  -> 提交 skill + 脚本 + fixture + provenance
  -> 自动检查
  -> Owner / 指定 reviewer 审查
  -> 实验或适配通道
  -> benchmark 和灰度
  -> Owner 决定 merge / release / default
```

Contributor 的 PR merge 不等于进入官方默认 Composition。Owner 可以合并到 registry 但保持 `experimental` 或 `community` 状态，也可以拒绝并保留反馈。

### 12.2 Skill PR 范围

本阶段 PR 仅允许涉及：

- `preset/capital-generation/skills/` 中的 skill 内容。
- Skill manifest、`scripts/**/*.ts|py`、fixtures、contract / safety tests。
- gotcha 脱敏样例、provenance、许可证和产品设计文档。
- 为 Skill Synergy 所必需的贡献指南和校验脚本。

不允许在同一个 Skill PR 中修改数据源、图表、watchlist、普通工具注册、宿主 API、其他 Agent 业务逻辑或无关构建系统。跨模块需求必须另开设计和 PR。

### 12.3 PR 必备内容

- 对应的 Framework slot、关系和适用角色。
- `SKILL.md`、manifest、工具 / 脚本入口和权限说明。
- 正常、边界、失败、越权和本地 gotcha fixture。
- 输入输出、错误处置、预算、确定性和已知局限。
- 来源、upstream commit / release、许可证和改编范围。
- 不会自动上传本地 gotcha、不读取凭据、不外传原始数据的说明。
- 测试命令、结果和与现有 canonical skill 的比较。

### 12.4 Review 与 Merge

- 文档 / 案例 / 脱敏 gotcha：Owner 或指定 reviewer 一人审核。
- workflow / perspective / verifier：领域 reviewer + Owner 审核。
- 工具、脚本、网络、文件、凭据或 policy：至少两名 reviewer，Owner 必须批准。
- 修改 Framework Blueprint、默认 Composition 或主 / 子 Agent 边界：必须由 Owner 明确批准。

CI 至少检查 manifest、依赖关系、脚本入口、输出契约、权限交集、敏感信息、路径穿越、提示注入、许可证和现有 Skill Synergy 回归。发布物必须有 digest；修复发布新版本；严重问题进入 `withdrawn`，不能修改已发布版本。

## 13. Registry 与运行时架构

```text
Framework Blueprint / Owner Roadmap
               |
               v
Skill Registry -- Provenance / License -- Release Artifact
               |
               v
Composition Resolver <--- Host Policy / Agent Capabilities
               |
               v
Turn Composition Snapshot
               |
               v
DSH Preset / Skill Loader / Subagent / Tools / Scripts
               |
               v
Local Gotcha Store ---- Next-turn Candidate / Optional PR
```

组件职责：

- **Framework Blueprint：**Owner 维护抽象槽位、关系、边界和质量标准。
- **Registry：**skill、脚本、版本、来源、状态和 benchmark 结果。
- **Resolver：**按轮次解析 skill、工具、脚本、角色、依赖、冲突和预算。
- **Turn Snapshot：**轮次运行期间唯一有效的不可变 Composition。
- **Local Gotcha Store：**保存用户私有经验，不自动上传、不改变 Release。
- **DSH Adapter：**映射到官方 preset、skill loader、subagent 和 toolFilter。

建议实现模块：

```text
src/skills/
├── framework.ts       # Blueprint 槽位、关系和约束
├── manifest.ts        # manifest schema 与归一化
├── registry.ts        # 本地 / 远程索引与 provenance
├── resolver.ts        # 轮次组合、依赖、冲突、预算和权限
├── snapshot.ts        # immutable turn composition
├── gotcha-store.ts    # 用户本地经验与脱敏状态
├── contracts.ts       # 输出 / 工具 / 脚本 fixture
└── diagnostics.ts     # 可操作错误和报告
```

优先复用 DSH 的 `agentPresets`、`skill-filesystem`、`tool-skill`、`tools`、session 和 sandbox 服务；Skill Synergy 不注册第二个 skill provider，不对运行中的 turn 做 overlay。

## 14. 安全与治理

### 14.1 权限交集

```text
skill declared permissions
  ∩ agent role permissions
  ∩ turn composition policy
  ∩ host policy
```

脚本入口和工具调用都必须通过这道交集。skill、gotcha 和外部内容不能改变 system policy、toolFilter、凭据策略、数据保留或审计设置。

### 14.2 本地 gotcha 隐私

本地 gotcha 默认只存用户本地；不保存原始 rows、密钥、绝对路径和无需保留的原始用户内容；上传、分享、转为 PR 均需用户主动操作并先脱敏。用户可以按 skill、时间、场景删除 gotcha。

### 14.3 金融研究治理

所有相关 skill 区分事实、观点、推断和假设；披露来源、采集时间、缺失字段、数据延迟和冲突；不保证收益或准确率；不执行交易、转账或账户操作；输出风险、失效条件和下一步验证。

### 14.4 审计

每个 turn 记录 session ID、turn ID、composition digest、skill / script release、Agent 角色、工具调用摘要、Dataset / profile / chart 引用、gotcha 版本和失败 / 降级 / 冲突状态。审计只保存必要的 opaque ref、摘要和元数据。

## 15. 质量与运营指标

质量维度包括：正确性、任务适用性、工具 / 脚本效率、证据完整性、安全性、维护性、gotcha 采纳率、gotcha 误用率、Contributor PR 周期和 Owner 复查覆盖率。

| 指标 | 定义 | 目标 |
|---|---|---|
| Composition success rate | 轮次在选定组合下完成任务的比例 | 上升 |
| Evidence completeness | 结论带来源、时间和局限的比例 | 上升 |
| Perspective complementarity | 增加视角后产生新增证据的比例 | 上升 |
| Unnecessary invocation rate | 无信息增益的 skill / 工具 / 脚本调用 | 下降 |
| Gotcha reuse rate | 被后续相似轮次有效复用的本地 gotcha 比例 | 上升 |
| Gotcha promotion rate | 脱敏后形成可验证候选的比例 | 适度上升 |
| Local adaptation incident rate | 本地 gotcha 导致错误或误导的比例 | 为零或极低 |
| PR cycle time | Skill PR 从创建到 Owner 决策的中位时间 | 下降 |
| Security incident count | 越权、注入、凭据或数据泄露事件 | 为零 |

## 16. 版本与回滚

Skill Release 使用 SemVer 和 content digest；工具 / 脚本入口、输入输出契约、角色边界或权限变化属于破坏性变更，必须升级 major。Local Gotcha 不改变 Release 版本，但记录所基于的 baseVersion。

每个 turn 固化 Composition snapshot。回滚时，下一轮恢复到上一个已验证的 snapshot / Release；当前正在运行的 turn 不被强行切换。基础版本升级后，旧 gotcha 必须重新做兼容评估。

## 17. 分阶段路线图

### P0：Owner 框架和现有 skill 盘点

定义 Framework Blueprint、槽位、关系、边界和质量标准；盘点五个现有 `capital-*` skill 的工具、脚本、角色和输出；重构 `CONTRIBUTING.md`；建立 provenance、gotcha 和 Composition 文档格式。

**验收：**每个现有 skill 都能映射到 Blueprint，能说明工具 / 脚本入口和角色边界；其他模块不发生改动。

### P1：Manifest、Registry 与 dry-run

实现 skill / script manifest、来源索引、依赖和关系解析、轮次 Composition dry-run、工具权限交集和诊断报告。

**验收：**复杂任务可在启动轮次前预览 Composition、成本、权限、冲突和降级原因。

### P2：轮次快照与本地 Gotcha

实现 `prepareTurnComposition`、不可变 turn snapshot、本地 gotcha store、用户确认、下一轮建议和脱敏导出；明确不实现运行中 overlay。

**验收：**同一 session 的不同轮次可使用不同组合；运行中的轮次无法改变 skill；gotcha 只影响后续轮次。

### P3：Owner 外部项目引入和 Contributor PR

建立周期性开源项目搜寻、due diligence、适配、benchmark、灰度和撤回流程；发布 Skill PR 模板和 CI；按 Owner 决定进入 official / adapted / experimental / community。

**验收：**Contributor 能在框架槽位内提交 skill；Owner 能审查、合并、发布、回滚并保留来源链。

### P4：自进化评测闭环

对 gotcha 做聚类、重复场景检测、脱敏 fixture 生成、候选变更评估和 Owner 审核；推荐最小充分的下一轮 Composition，不自动提高权限。

## 18. MVP 定义

**必须包含：**Framework Blueprint；Skill 类型与框架槽位；manifest 中的工具 / 脚本入口；主 / 子 Agent 绑定；依赖、关系、冲突、权限和预算解析；轮次 Composition snapshot；本地 gotcha store 和用户确认；Owner 主导的 `CONTRIBUTING.md`；来源和许可证；PR 自动检查和人工 merge；统一多视角证据契约。

**暂不包含：**运行中热插拔；社区 skill 任意代码执行；skill 自行安装工具或修改 policy；gotcha 自动上传 / 自动发布；无 Owner 确认的默认组合变更；本次 Skill Synergy 之外的模块改造。

## 19. 验收标准

### 19.1 框架与装配

1. 任一 skill 能说明对应的 Framework slot、关系、角色和边界。
2. 工具与 `*.ts` / `*.py` 脚本入口可追踪到 manifest、权限和测试。
3. 缺失依赖、冲突、越权和超预算在轮次启动前被拒绝或明确降级。
4. 同一 session 的不同轮次可以使用不同 Composition。
5. 一个轮次开始后，skill、工具、脚本和 gotcha snapshot 不可修改。
6. 子 Agent 继承轮次 snapshot，不得偷偷加载未声明能力。

### 19.2 自进化

1. 用户可以接受、拒绝、查看和删除本地 gotcha。
2. gotcha 只影响后续轮次，不改变当前运行。
3. 本地 gotcha 默认不上传、不保存敏感原文、不改变权限。
4. 用户可以把脱敏 gotcha 转为 fixture、候选变更或 Contributor PR。
5. 基础 Release 升级时，旧 gotcha 会重新检查兼容性。

### 19.3 Owner 与社区

1. `CONTRIBUTING.md` 明确 Owner 主导、Contributor 辅助和本阶段范围。
2. Owner 能按框架缺口定期发现、评估和适配优秀开源项目。
3. Skill PR 能通过 manifest、脚本、权限、来源、许可证、安全和回归检查。
4. merge 不自动进入默认 Composition；发布物有 digest、状态和回滚路径。
5. 其他业务模块不会被 Skill Synergy PR 隐式修改。

## 20. 产品决策摘要

1. **产品名称改为 Skill Synergy。**Tree 只可以是展示方式，不再是产品本体。
2. **Owner 先定义框架，再定义 skill。**具体 skill、Perspective Lens 和 Skill 类型都是框架的实例或环节。
3. **工具调用是正式能力面。**仓库工具以及 skill 内 `scripts/**/*.ts|py` 都必须进入 manifest、测试和权限审查。
4. **同一 session 跨轮次换组合，单轮运行不可变。**不做运行中热调整。
5. **可版本化与可自进化分层。**Release 保证可复现；本地 gotcha 提供个性化演进；是否公共化由用户和 Owner 决定。
6. **Contributor 在框架内贡献，Owner 决定官方化。**社区 merge、实验发布和默认启用是三个不同动作。
7. **本次范围只围绕 Skill Synergy。**其他业务模块不通过本设计入侵。
