# 插件页详情文档（plugin-page）

> 索引见仓库根 `AGENTS.md` §14；改 `plugin-page/`、`locale/*.json` 的 `meta.detail` 或发布清单前读本页。
> 页面正文是用户文档；维护规则只在这里。

## 14.1 定位与更新触发

- `plugin-page/` 是**已安装用户的索引页**，不是 README 副本：只写产品形状不变的事实，详情链到 README / CHANGELOG / docs。
- 只在这些变化时更新：名称与定位、支持市场、模式名称与一句话职责、CapGen 投研自动化的一段说明、首次使用路径、配置卡位置、版本与回滚规则、风险提示、链接索引。
- 纯内部重构、测试、依赖升级、功能细节、数量变化不动它；这些住 README / CHANGELOG。
- zh/en 两份同步；只改一份会让另一种界面看到旧内容。

## 14.2 内容边界（防冲突）

- 会随版本变的事实只住 README / CHANGELOG：写死的具体版本号、DSH 基线、能力 / 模板 / Skill 数量、安装备选、截图、完整模式表、示例、FAQ。
- `plugin-page` 只保留：一句话定位、支持市场、三种模式名称与一句话、CapGen 投研自动化的一段说明、首次使用三步、配置卡在本文下方、版本与回滚规则、风险提示、README 索引。
- 需要细节时写绝对 GitHub URL；相对链接在插件页不可点。
- 不重复 README 的标题、完整表格与截图；同一事实只允许一个权威来源。

## 14.3 格式与图片

- 只写 Markdown；禁 raw HTML（`<img>`、`<p>`、`<details>`、`<a>`、`<table>` 等）——宿主按 `omitHtml` 渲染，HTML 会被整段省略。
- 插件页不放本地图片；徽章用绝对 HTTPS（至少一张 npm 动态版本徽章），截图与示意图留在 README，避免随 UI 过期和包体膨胀。
- 徽章是外部资源，不进 `files`；文档 ≤1 MB；建议 ≤80 行 / ≤6 KB，详情文档显示在配置卡上方，过长会把配置推远。
- 不写 `width` / `align`；徽章必须有 alt。

## 14.4 locale 与发布清单

- `locale/<lang>.json` 的 `meta.detail` 指向 `plugin-page/README.<lang>.md`；文件必须存在且进 `files`。
- 缺文件时宿主报 `invalid`，**不会回退 README**；不要靠 README 兜底。
- `plugin-page/` 是发布物，不是 `docs/` 研发文档；不要放 `docs/`（`test/packaging.test.mjs` 的反向闸门会红）。
- 徽章是外部 HTTPS，不进 `files`；`plugin-page/` 目录必须进 `files`。

## 14.5 回归与验收

- `test/packaging.test.mjs`：`meta.detail` 在包里、文档无 raw HTML、只引用绝对 HTTPS 徽章、至少一张 npm 动态版本徽章、不放本地图片、locale 路径合法。
- `test/readme-prose.test.mjs`：插件页文档同样不写 §编号、`docs/dev/`、`ctx.*`、仓内源码路径。
- 真机用 npm 安装（不是 `link:`）打开插件页：徽章、zh/en 切换、配置卡位置、版本段。
