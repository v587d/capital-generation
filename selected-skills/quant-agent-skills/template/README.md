# Template: 最小适配骨架

把本目录结构复制到你的量化项目里，替换 `{{QUANT_ROOT}}` 后即可作为
三个 skill 的工作区。

```text
template/
├── .env.example          # QUANT_ROOT 示例
├── research/
│   └── knowledge/        # 组合账本与研究结论 SSoT（文件名即契约）
└── scripts/              # 你的闭环脚本占位（v1.1 前自行实现）
```

## 契约文件（文件名即契约，勿改名）

`research/knowledge/` 下按需创建：

- `portfolio_state.json` — 组合事实（持仓、市值、仓位）
- `trade_history.json` — 交易账本（先于任何结论）
- `research_verdicts.json` — 研究结论 + triggers
- `watchlist.json` — 关注池
- `portfolio_research_bridge.md` — 持仓—研究映射桥
- `research_subjects.json` — 行业/主题研究对象

首次使用：`cp .env.example .env`，把 `QUANT_ROOT` 改成你的绝对路径，然后
把 `{{QUANT_ROOT}}` 全局替换为该路径。
