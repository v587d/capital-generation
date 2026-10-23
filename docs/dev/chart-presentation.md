# 图表呈现纪律：准入与呈现（`render_chart`，只有 visualization_specialist 持有）

> 索引见仓库根 `AGENTS.md` §6。改 `src/chart/`、`chart-ui/` 或 `root-tool-policy.ts` 之前读这里；
> 交付登记与回合归属的单列在 §6.3（`chart-delivery-events.md`）。§编号沿用 `AGENTS.md` 的全局命名空间。

## 6.1 准入与 gate

- **根 Agent 的工具面在组合期封闭**（2026-10-19 D0）：`capital-generation` 只挂 time / ocr /
  watchlist / present / root-extras 五行，`render_chart` / `prepare_chart_source` / 出网那十三颗**根本不在根的
  composition 里**，所以 `src/agents/root-tool-policy.ts` 在生产装配下以 `deny: false` 注册——created
  监听只记现场、不再逐名 deny（`ROOT_AGENT_DENIED_TOOLS` 那份名单留给单体载体）。**不要在 preset /
  standing 层写 deny**（allow/deny 只是交集过滤，加不回来，会把 specialist 一起砍掉）；**也不要**把
  specialist 创建工具写进主 persona 白名单——边界由工具表承载。
- **⛔ 根收敛监听只能挂 `ctx.root`**（未打 scope 标签）：`agent/created` 的路由键是 agent 对象
  本身，挂 standing scope 上的监听器**收不到且不报错**；挂 `ctx.root` 后必须用
  `agentPresets.composedPreset()` 筛出本 preset。回归 `test/root-tool-policy.test.mjs`。
  **但按人设的调用级闸门（`tools.guard()`）不挂 created**：宿主先建 Agent、后选人设，那条时机上身份
  还没落定（§1.1 → `data-roles.md`，账本 L32），三颗身份闸门因此全局装在插件 ctx 上、各一次。
- **⛔ 委派出口只有专用角色那几颗，角色工具面由 preset 挂的**族行**表达**：2026-10-18 用户决策
  删掉通用 `subagent` 行（没有明确场景就不该有「其他」）；2026-10-19 D0 把本仓模型工具按族拆成
  `@v587d/capital-generation/tools/*` 独立入口行，"谁能用什么"从此只写在 `agent.patch.yml` 的行
  组合里（官方四颗 preset 的同一形状），运行期那份名字级 allow 清单已删除。两种形状的失败方向
  不同：deny 名单是 fail-open（漏写一个名字就等于有权限，2026-09 的出图绕过事故这么来的），
  allow 名单与行组合都是 fail-closed（多写/多挂才会越权），而行组合还多两点好处——① 名单里一个
  看不见的名字会让**整批** `restrict()` 抛错、该角色完全不收敛且静默，行名写错则是那一行装载
  失败、能力缺一整族（`test/persona.test.mjs` 的组合表与 `test/family-entries.test.mjs` 的行契约
  两头都钉）；② 不发明宿主没有的概念，宿主改 preset 形状时不必再跟着改一份我们自己造的机制。
  **残留只有一格**：`dsh-tool-subagent-control` 把 `send_message` 与 `interrupt_agent` 焊在同一行、
  宿主没给成员开关，叶子角色用**逐名 tolerant deny** 只减那一个兄弟（`src/agents/role-tool-policy.ts`
  的 `SIBLING_DENIED_TOOLS`）——把它长成第二份工具面清单就是禁止恢复的形状。新增委派行必须同时
  决定该角色挂哪几行；恢复通用委派行 = 一并恢复那个绕过入口，禁止。回归 `test/persona.test.mjs`
  「委派出口只有专用角色」「组合表：每颗 preset 挂的族行必须恰好是这几行」与
  `test/role-tool-policy.test.mjs`、`test/family-entries.test.mjs`。
- **⛔ 序列旁路必须接平台认证围栏**：`chart-ui/index.js` 的 `/capital-charts` 路由把
  `ctx.get('connection').requestRejection(req)` 接进 handler（认证先于方法 / 路径判定）；
  `webServer` 本身不做认证，不接就是无认证端点。账本 L13、探针 `check:dsh`、回归
  `test/chart-host.test.mjs`。

## 6.2 模型侧呈现纪律

- **细则不在本文**（与 §4.1 → `web-retriever.md` 同口径）：不出图 / 不罗列图表文件、一张图一个
  `chart_source_ref`（15 分钟 TTL）、一对一不叠图、被排除视图记进 `warnings`、spec 由 specialist
  组装——persona 或 skill 里各有**被测试钉住的**一份，此处不复述。
- **数据的物理路径**：`render_chart` 只回小回执，序列写 `capital-analysis/charts/<id>/`，浏览器
  经旁路取，**不进任何 Agent 上下文**；交付事件也不进 `deriveMessages()`。进对话流的**唯一**方式
  是官方 `deliverables/presented`（§6.3 → `chart-delivery-events.md`）；auto 模式下由收尾流的
  终端帧写入（`present_charts` 只记录清单），不在出图时自动登记。跨数据集归一化对照当前**没有**
  合规路径。
- **工具面落点**：出图链仍只在 `visualization_specialist`（`tools/chart-render`）；根 preset 多挂
  的一条是 `tools/present`（只带 `present_charts`，不渲染、不读数据）。它是「主 Agent 只在收尾写
  交付」的模型可见出口——不要把它并进出图行，也不要把 `render_chart` 加回根 preset。
- **降级底线**：`chart.html` 自包含可离线打开，也是官方文档 preview iframe 的渲染目标
  （接管见 `chart-ui/README.md`）；`html_path` 始终在回执里。
- **构建产物**：`chart-ui/client.js` 是 esbuild 产物（源码 `client.src.cjs`）；改源码或
  `src/chart/runtime.ts` 后必须 `npm run build` **并提交产物**、**刷新页面**（bundle 在页面加载
  那一刻确定，重启宿主不替换已打开页面那份；缺失会让整个 web profile 起不来，恢复手册见账本）。
