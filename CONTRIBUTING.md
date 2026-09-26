# Contributing to Capital Generation

感谢你对 **Capital Generation** 的兴趣！  
本项目仍在积极迭代中，欢迎任何形式的贡献（代码、文档、测试、Issue、使用反馈等）。

> **重要提示**  
> 本项目是面向中国散户的证券研究 AI Agent 插件，**不提供任何投资建议或金融服务**。  
> 所有贡献内容请保持中立、客观，避免给出买卖建议。

## 贡献方式

我们欢迎以下类型的贡献：

| 类型 | 说明 | 难度 |
|------|------|------|
| 文档改进 | 修正错别字、补充说明、翻译、使用案例 | ⭐ |
| 测试补充 | 增加单元测试 / 冒烟测试 | ⭐⭐ |
| 数据能力扩展 | 新增或修复 Fuyao / AnySearch 相关 capability | ⭐⭐ |
| 可视化增强 | 新图表类型、交互优化 | ⭐⭐ |
| 子 Agent 完善 | 尤其是 `data_analyst` 角色 | ⭐⭐⭐ |
| 新功能 / 架构 | 新角色、新工具、性能优化 | ⭐⭐⭐ |


## 开发环境准备

1. 安装 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)（当前适配 `@0.1.7-rc.2`，
   需要 DSH ≥ 0.1.7：0.1.5 的 settings 注册面与 preset 挂载方式已被上游删除）
2. 克隆本仓库：
   ```bash
   git clone https://github.com/v587d/capital-generation.git
   cd capital-generation
   ```
3. 安装依赖并构建：
   ```bash
   npm install
   npm run build
   ```
4. 配置 API 密钥（`~/.dsh/.credentials.yaml`）：
   ```yaml
   ANYSEARCH_API_KEY: as_sk_......
   FUYAO_API_KEY: sk-fuyao-......
   WIND_API_KEY: ak_......   # 推荐
   PADDLE_OCR_TOKEN: ......  # 可选：web_retriever 的 ocr 工具解析 PDF 正文
   ```
5. 运行测试：
   ```bash
   npm test
   npm run check:dsh
   npm run smoke:boot
   ```
   动过交付通道或准备发版时再加跑 `npm run verify:sessions`（用本机已装的 dsh 后端逐份冷加载真实会话）。

## 提交流程（Pull Request）

1. **Fork** 本仓库并创建新分支：
   ```bash
   git checkout -b feat/your-feature-name
   # 或
   git checkout -b fix/issue-number
   ```

2. 完成修改后，请确保：
   - 代码通过所有测试：`npm test`
   - 兼容性检查通过：`npm run check:dsh`
   - 能正常启动：`npm run smoke:boot`
   - 已 rebase 到最新的 `master` 分支

3. 提交时请使用清晰的 commit message：
   ```
   feat: 增加 xxx 能力
   fix: 修复 data_junior 在空数据时的崩溃
   docs: 补充 data_collector 使用说明
   ```

4. 推送并创建 Pull Request，在 PR 描述中请说明：
   - 解决了什么问题 / 实现了什么功能
   - 相关 Issue 编号（如果有）
   - 测试情况（截图更佳，尤其是图表相关）

5. 等待 Review。我们会尽快回复。

## Issue 规范

- **Bug 报告**：请尽量提供复现步骤、DSH 版本、相关日志或截图。
- **功能请求**：请说明使用场景和期望行为。
- **数据接口问题**：请注明具体 capability 名称和上游返回情况。

创建 Issue 前可先搜索是否已有相关讨论。

## 代码风格与约定

- 遵循现有代码风格（TypeScript + 项目已有配置）。
- 新增 capability 时请同步更新 `docs/data-collector-capabilities.md`（可通过 `npm run docs:capabilities` 生成）。
- 不要硬编码 API Key 或敏感信息。
- 保持数据隔离原则：原始结构化数据不应直接进入主 Agent 上下文。

## 行为准则

请保持友好、尊重和建设性的交流。  
我们希望社区对所有参与者（无论经验水平）都是包容和欢迎的。

## 有问题？

- 直接提 Issue
- 或在 GitHub Discussions 中讨论

再次感谢你的贡献！  
让我们一起把这个面向散户的研究助手做得更好。

---

**License**: MIT  
**Maintainer**: [Shawn](https://github.com/v587d)
