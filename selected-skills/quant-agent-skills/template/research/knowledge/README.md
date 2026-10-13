# knowledge SSoT

此目录存放三个 skill 依赖的账本与研究结论文件。文件名即契约：

- `portfolio_state.json` — 组合事实（positions/holdings、market_value、position_ratio）
- `trade_history.json` — 交易账本（先补事件，再重算组合）
- `research_verdicts.json` — 研究结论 + triggers（upsert 写入，禁止裸覆盖）
- `watchlist.json` — 关注池
- `portfolio_research_bridge.md` — 持仓—研究映射桥
- `research_subjects.json` — 行业/主题研究对象

示例结构见各 SKILL.md 的 output-contract。所有写入走"读取→合并→原子写"，
禁止直接 `open(..., "w")` 覆盖共享 JSON。
