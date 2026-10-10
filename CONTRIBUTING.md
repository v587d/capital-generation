# Skill Synergy 贡献与治理指南

感谢你参与 Capital Generation 的 **Skill Synergy** 建设。

本指南是当前阶段的唯一贡献入口。当前阶段只围绕 skill、Skill Synergy Framework、skill 内工具 / 脚本调用、本地 gotcha 和相关文档与测试展开。数据源、行情、图表、watchlist、普通工具、宿主 API、其他 Agent 业务逻辑和无关架构改动不属于本阶段范围，不得混入 Skill Synergy PR。

> **重要提示**
>
> 本项目是证券研究 AI Agent 插件，不提供投资建议或金融服务。Skill 必须保持中立、可验证、可追溯，不得承诺收益、准确率或未来表现。

## 1. 治理模型

### 1.1 Owner 主导

Skill Synergy 由项目 Owner 主导。Owner 负责：

- 定义 Framework Blueprint、抽象槽位、skill 关系、命名和质量门槛。
- 维护官方 skill、默认 Composition、核心 policy 和主 / 子 Agent 边界。
- 根据能力缺口定期寻找、评估和适配优秀开源项目。
- 决定贡献进入 `official`、`adapted`、`experimental`、`community` 或被拒绝。
- 审核工具、脚本、网络、文件、凭据、数据访问和默认组合变更。
- 决定 release、灰度、撤回和回滚。

Contributor 在 Owner 定义的框架内提供实现、案例、fixture、gotcha 和适配建议。Contributor 可以提出框架变更，但不能在普通 skill PR 中直接改变 Blueprint、默认 Composition 或角色边界。

### 1.2 Skill Synergy Framework

一个 skill PR 必须说明自己填补哪个框架槽位，以及和其他 skill 如何协同：

```text
Intent / Context
  -> Role / Collaboration
  -> Perspective Lens
  -> Evidence
  -> Method / Workflow
  -> Tool / Script
  -> Verification
  -> Delivery
  -> Local Learning / Gotcha
  -> Governance
```

具体 skill 是框架的实例，不是框架本身。产品界面可以用树、矩阵或关系图展示，但 Contributor 不应把贡献设计成孤立的“新节点”。

## 2. 允许的贡献范围

本阶段 PR 仅允许修改以下内容：

- `preset/capital-generation/skills/` 中的 `SKILL.md`。
- skill manifest，例如 `skill.yaml`。
- skill 内 `scripts/**/*.ts`、`scripts/**/*.py` 及其调用契约。
- skill 的 fixtures、contract test、tool-call test、safety test。
- 脱敏的本地 gotcha 样例、provenance、许可证和 Skill Synergy 设计文档。
- 为上述检查服务的贡献指南、模板和校验脚本。

以下内容禁止混入本阶段 PR：

- 数据源、capability、行情、财务或网页来源实现。
- 图表、可视化前端、watchlist 或 OCR。
- 普通 Agent 工具注册、DSH 宿主 API、session 生命周期实现。
- 与 Skill Synergy 无关的子 Agent 角色、构建系统和架构重构。
- 任何读取凭据、外传用户数据或绕过现有工具权限的实现。

跨模块需求必须另开 Issue / 设计文档 / PR，并明确说明不属于本阶段 Skill Synergy 贡献。

## 3. Skill 的组成

一个可提交的 Skill Release 至少包含：

```text
skill/<skill-id>/
├── SKILL.md
├── skill.yaml
├── scripts/                 # 可选：*.ts / *.py
├── tests/
│   ├── fixtures/
│   ├── contract.test.yaml
│   ├── tool-call.test.yaml
│   └── safety.test.yaml
├── examples/                # 可选，必须脱敏
├── LICENSE
└── provenance.json
```

`SKILL.md` 面向模型，描述协同规则和使用边界；`skill.yaml` 面向 Resolver 和 CI，声明槽位、依赖、关系、角色、工具、脚本、权限、预算和输出契约；`scripts/**/*.ts|py` 是正式能力面，不能隐藏未声明的网络、文件、凭据或 shell 行为。

## 4. 工具与脚本要求

每个工具或脚本入口必须说明：

- `entrypoint`、调用角色和允许的调用顺序。
- 输入 schema、输出 schema 和错误码。
- 允许使用的工具集合，不得动态拼接未知工具名。
- Dataset、profile、workspace、网络和凭据访问范围。
- 重试次数、停止条件、超时、token、调用次数和并发预算。
- 是否确定性、是否依赖外部数据、如何记录来源。

Skill 的声明不会自动增加工具权限。最终权限必须是：

```text
skill permissions
  ∩ agent role permissions
  ∩ turn composition policy
  ∩ host policy
```

不得把原始 rows、API Key、密码、绝对路径或未经脱敏的用户内容写入 Skill、fixture、gotcha 或 PR。

## 5. 本地自进化与 Gotcha

Skill Release 是 Owner / Contributor 发布的可复现基线；本地 gotcha 是用户在具体场景中的私有经验，两者不能混为一个版本。

Gotcha 可以记录：

- 触发场景和脱敏上下文指纹。
- 观察到的问题和证据引用。
- 建议的处理方式、置信度和适用范围。
- 基于哪个 Skill Release 版本。

Gotcha 默认只存用户本地，不自动上传、不自动同步、不自动生成公共 skill。它不能修改 policy、角色边界、工具权限、数据保留或安全规则。

贡献者可以在获得用户同意后，把脱敏 gotcha 转成 fixture、候选变更或 PR。一次反馈不能直接写成普遍规则；必须有重复样例、清楚边界和回归测试。

## 6. Owner 搜寻和引入外部项目

Owner 按能力缺口持续寻找项目，按当前资源进行轻量复查和阶段性评估。候选项目应记录：

- upstream URL、owner/repository、commit / release、作者和维护状态。
- 稳定 catalog key、能力标签、适用市场/任务范围和用户可见风险提示。
- 许可证、依赖和再分发条件。
- 实际工具 / 脚本入口、网络行为、文件行为和凭据行为。
- 能填补的 Framework slot、与现有 skill 的关系和适配成本。
- benchmark、回归、安全检查和预期收益（尚未完成的项目要明确标为冷启动实验）。

外部项目必须通过 provenance、许可证、提示注入、敏感信息、路径和权限审查。引入的是可追溯、默认关闭的实验能力，不是直接复制上游项目的 Agent 架构、系统提示词或默认权限。Owner 欢迎通过 PR 提交新的固定快照、catalog 标签和复查记录；维护频率、评分和 benchmark 在冷启动阶段主要用于风险提示与排序，不单独阻止通过硬门槛的用户自选实验。候选硬门槛、阶段状态和未来收紧路径见[社区 Skill 引入与选用手册](docs/design/external-skill-intake.md)；本轮 GitHub 评估结果见[社区金融 Skill 候选扫描（2026-10）](docs/reference/external-skill-scan-2026-10.md)。

## 7. Issue 与 PR 流程

### 7.1 先提 Issue

以下情况应先开 Issue：

- 新的 Framework slot、关系或默认 Composition。
- 新增网络、文件、凭据、执行代码或外部副作用。
- 引入成熟开源项目。
- 需要改动现有角色边界或工具权限。
- 本地 gotcha 可能适用于多个用户或多个场景。

Issue 必须包含问题、目标场景、框架位置、预期收益、风险、是否涉及外部项目和是否超出本阶段范围。

### 7.2 PR 必备内容

PR 描述必须回答：

- 这个 skill 填补哪个 Framework slot？
- 它与哪些 skill 是 `requires`、`complements`、`alternative`、`verifies` 或 `conflicts` 关系？
- 面向哪些 Agent 角色，明确不面向哪些角色？
- 新增了哪些工具 / 脚本入口和权限？
- 输入输出、错误处置、预算、确定性和已知局限是什么？
- 是否有 upstream、许可证、改编内容和 provenance？
- 是否包含正常、边界、失败、越权和 gotcha fixture？
- 是否保证本地 gotcha 不自动上传、不读取凭据、不外传原始数据？
- 与现有 canonical skill 相比，增益和成本是什么？
- 如何回滚或撤回？

### 7.3 分支与提交

```bash
git checkout -b skill/<short-name>
```

建议使用清晰的提交信息：

```text
feat(skill): add risk perspective gotcha
fix(skill): correct tool-call contract
test(skill): add permission boundary fixture
docs(skill): explain upstream provenance
```

## 8. 自动检查

PR 至少通过：

1. manifest schema、命名、版本和目录布局检查。
2. SKILL.md 体积、编码、敏感信息和隐藏指令检查。
3. 依赖、关系、冲突、重复实现和版本解析检查。
4. 工具 / 脚本入口与角色权限一致性检查。
5. 输出 contract、错误处置和 tool-call fixture。
6. 提示注入、凭据读取、网络外传、路径穿越和原始数据泄露检查。
7. provenance、许可证和第三方依赖检查。
8. 与当前 DSH 装配和 Skill Synergy 相关的回归检查。

当前适配 `@0.2.0-rc.2`，需要此版本或更新版本。Skill Synergy 贡献者应在 Linux Web profile 或 Windows 桌面端验证装配行为。

当前仓库基础回归命令：

```bash
npm install
npm run build
npm test
npm run check:dsh
npm run smoke:boot
```

如果 PR 只包含文档或脱敏 gotcha，也要运行适用的 manifest / 文档检查，并在 PR 中说明未运行的检查及原因。不要为了让 CI 变绿而删减安全断言、放宽权限或改变其他模块的测试。

## 9. Review、Merge 与发布

按风险分层：

- 文档、案例、脱敏 gotcha：Owner 或指定 reviewer 一人审核。
- workflow、perspective、evidence、verifier：领域 reviewer + Owner 审核。
- 工具、脚本、网络、文件、凭据或 policy：至少两名 reviewer，Owner 必须批准。
- Framework Blueprint、默认 Composition、主 / 子 Agent 边界：必须由 Owner 明确批准。

PR merge 后不自动进入默认 Composition。Owner 可以将它放入 `experimental` 或 `community`，先做 benchmark 和灰度；只有明确批准后才进入 `official` 或默认组合。

发布物必须不可变，并包含版本、content digest、来源、许可证、测试结果和回滚路径。修复发布新版本，不修改已发布内容。发现安全、许可证、严重误导或越权问题时标记 `withdrawn`，禁止新轮次使用并公开影响版本和处理方式。

## 10. 贡献者行为准则

- 不提交 API Key、密码、用户数据、会话全文或未脱敏材料。
- 不把观点、媒体转述或偶然 gotcha 写成确定事实。
- 不隐藏工具调用、网络访问、文件读写或脚本副作用。
- 不通过 skill 绕过 DSH 的 Agent、session、workspace 和工具边界。
- 尊重 upstream 许可证和作者，完整保留来源与改编范围。
- 对金融内容保持中立，明确不确定性、风险和失效条件。
- 对 review 意见逐条回应，无法解决时说明具体阻塞点。

## 11. 维护联系

- Skill 设计、Framework slot 和默认组合：提交 Issue，标注 `skill-design`。
- 外部项目适配和 provenance：提交 Issue，标注 `skill-adoption`。
- Skill bug、工具 / 脚本契约和 gotcha：提交 Issue，标注 `skill-bug` 或 `skill-gotcha`。
- 安全问题：不要公开发布敏感细节，使用仓库维护者提供的私下渠道。

本指南只服务 Skill Synergy 阶段。其他模块的贡献应遵循后续单独发布的模块指南，不应借此 PR 进入本仓库。

---

**License:** MIT
**Maintainer:** [Shawn](https://github.com/v587d)
