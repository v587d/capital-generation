# Calculation Helpers

这里没有能跑代码的宿主：本插件的分析角色不带 shell，也不复用上游那份共享计算模块（它不进发布包）。
下面每个名字对应一个可以手算的量——按 [methodology.md](methodology.md) 的基础算式在答复里把式子写出来算，
需要波动率一类的统计量时交给宿主数据侧（本插件里是委派 `data_junior`），不在这份附属文件里自己算历史序列。

Relevant functions for this skill:

- `fixed_fractional_position_size`
- `volatility_adjusted_position_size`
- `kelly_fraction`
- `futures_contract_risk`
- `price_risk_per_unit`

Keep the skill output grounded in the user's stated risk budget, friction assumptions, and contract details rather than defaulting missing values.
