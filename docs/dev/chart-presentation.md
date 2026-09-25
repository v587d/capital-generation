# 图表呈现纪律：准入与呈现（`render_chart`，只有 visualization_specialist 持有）

> 索引见仓库根 `AGENTS.md` §6。改 `src/chart/`、`chart-ui/` 或 `root-tool-policy.ts` 之前读这里；
> 交付登记与回合归属的单列在 §6.3（`chart-delivery-events.md`）。§编号沿用 `AGENTS.md` 的全局命名空间。

## 6.1 准入与 gate

- **根 Agent 工具收敛**：`src/agents/root-tool-policy.ts` 在 `agent/created` 时对主 Agent 自己的
  scope deny 掉 `render_chart` / `subagent_visualization_specialist` / `prepare_chart_source`
  （同一机制收敛 shell，§1.6 → `bash-gate.md`）。**不要在 preset / standing 层写 deny**（allow/deny
  只是交集过滤，加不回来，会把 specialist 一起砍掉）；**也不要**把 specialist 创建工具写进主
  persona 白名单——边界由工具表承载。
- **⛔ 根收敛监听只能挂 `ctx.root`**（未打 scope 标签）：`agent/created` 的路由键是 agent 对象
  本身，挂 standing scope 上的监听器**收不到且不报错**；挂 `ctx.root` 后必须用
  `agentPresets.composedPreset()` 筛出本 preset。回归 `test/root-tool-policy.test.mjs`。
- **⛔ 通用 `subagent` 行必须带 `toolFilter.deny`**（不要删）：三条工具链身份判据都只有
  `session.header.parentSession`，而 `dsh-subagent` 只在配了 toolFilter 时才 restrict，child 又
  composeFrom 父的 standing composition——没有 deny 的通用 child 继承全部工具、能自己签 token
  出图。deny 列表 = 数据管线 + Dataset 系列 + 出图 + 专用角色创建 + shell 槽位。回归
  `test/persona.test.mjs`「通用 subagent 行」。
- **⛔ 序列旁路必须接平台认证围栏**：`chart-ui/index.js` 的 `/capital-charts` 路由把
  `ctx.get('connection').requestRejection(req)` 接进 handler（认证先于方法 / 路径判定）；
  `webServer` 本身不做认证，不接就是无认证端点。账本 L13、探针 `check:dsh`、回归
  `test/chart-host.test.mjs`。

## 6.2 模型侧呈现纪律

- **细则不在本文**（与 §4 → `web-retriever.md` 同口径）：不出图 / 不罗列图表文件、一张图一个
  `chart_source_ref`（15 分钟 TTL）、一对一不叠图、被排除视图记进 `warnings`、spec 由 specialist
  组装——persona 或 skill 里各有**被测试钉住的**一份，此处不复述。
- **数据的物理路径**：`render_chart` 只回小回执，序列写 `capital-analysis/charts/<id>/`，浏览器
  经旁路取，**不进任何 Agent 上下文**；交付事件也不进 `deriveMessages()`。进对话流的**唯一**方式
  是官方 `deliverables/presented`（§6.3 → `chart-delivery-events.md`）。跨数据集归一化对照当前
  **没有**合规路径。
- **降级底线**：`chart.html` 自包含可离线打开，也是官方文档 preview iframe 的渲染目标
  （接管见 `chart-ui/README.md`）；`html_path` 始终在回执里。
- **构建产物**：`chart-ui/client.js` 是 esbuild 产物（源码 `client.src.cjs`）；改源码或
  `src/chart/runtime.ts` 后必须 `npm run build` **并提交产物**、**刷新页面**（bundle 在页面加载
  那一刻确定，重启宿主不替换已打开页面那份；缺失会让整个 web profile 起不来，恢复手册见账本）。
