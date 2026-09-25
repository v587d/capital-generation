# 时间轴：日历由宿主换算，模型只写日历

> 索引见仓库根 `AGENTS.md` §1.3。改 `src/data-collector/time-axis.ts`、`query-time.ts` 或任何
> 执行 QuerySpec 的入口之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 根因（真机 `1e44050e`）：只给毫秒坐标 ⇒ 模型心算 epoch、猜时区与交易日。**不是模型偷懒，是
> 没告诉它不要手算**。经过与实现理由见 `src/data-collector/time-axis.ts`、`query-time.ts` 头注释。

## 1.3 时间轴判据

- **宿主产出坐标**（`time-axis.ts` 全仓唯一一份偏移换算）：`time_facts` 带 ISO 覆盖范围、`axis`
  与 `windows[]`。查询侧**直接写日历**：filter 值接受 `YYYY-MM-DD` / `YYYY-MM` / `YYYY` /
  `{period}`，工具边界按该列偏移归一并补 `*_iso`；相对期省略锚点以**该 Dataset 最后一天**为准。
- **时区按列自身观测推断**（午夜余数反推偏移，归一到 `(-12h, +12h]`，过 `MIN_EPOCH_MS` 量级
  闸门）。推断不出**报 `unknown` 并要求显式 `time_column`，绝不猜**。
- **⛔ 日期串落到数值时间列必须响亮失败**：旧路径整条跳过 filter、"筛选消失返回全量"却看起来
  成功，比报错危险。`>` `<` `!=` `in` 配日期串一律 `query_type_conflict`；要哪几天写 `>=` `<=`。
  回归 `test/data-junior-tools.test.mjs`「响亮失败」。
- **⛔ 日期归一只有一个实现，所有入口都必须接**（事故 `66fa9666`：漏接一个入口 ⇒ 同一回合两种
  行为、静默错数）：实现在 `query-time.ts`。**新增任何执行 QuerySpec 的入口必须复用它**，等价性
  由 `test/describe-dataset.test.mjs`「内嵌 queries 与 query_dataset 同构」守着。
- **⛔ session 只能从 `exec.agent.session` 读，唯一实现在 `src/tool-exec.ts`**。**不提供
  `exec.session` 兜底**——兜底让本地测试绕过真实形状（真机 `cf464cb6` 漏网原因）。Dataset 形态
  只对**被委派**子 Agent 开放。回归 `test/data-junior-tools.test.mjs`「时间工具接线」。
- **`resolve_data_time_range` 两种形态**（改既有工具不新增）：`capability + period` 取数形态 /
  `dataset_id (+ time_column) + period` Dataset 形态；`period` 必填，两 id 二选一。
- **周窗口就是 7 天**：`resolvePeriod` 只减一次，不得叠加 `count - 1`（否则 `last_1_week` = 0
  天）。回归 `test/time-axis.test.mjs`。
- **窗口夹到真实交易日**：覆盖不到任何行时**报错并回显覆盖范围**，不返回空区间；探针有界
  （前 500 行、`windows` ≤8 条）。
- **`columns_of_interest` 必须收窄它承诺收窄的一切**（含 `time_facts` 首末值投影；时间列永远
  保留）。判据：参数在描述里的承诺 = 它实际影响的每个事实块。回归 `test/describe-dataset.test.mjs`。
