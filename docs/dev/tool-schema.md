# 工具 schema 与数据源验收（详情）

> 索引见仓库根 `AGENTS.md` §9 / §10（§9.1–§9.6 = 工具 schema 纪律，§10.1–§10.5 = 数据源验收
> 纪律）。改模型工具定义（`parameters` / `output`）或
> `src/sources/fuyao-rest.ts` 之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间；整数节只住在根，
> 通用判据 §9.7（同一能力多入口）也留在根，代码注释按 `AGENTS.md §9.7` 指过去。

## 9.1 `parameters` 根只能是 object

统一由 `jsonObject()` 构造 `{ type:'object', properties, required }`。根级 `oneOf` / `anyOf` /
`allOf` 或不写 `type` 会被供应商在第一个 token 前整体拒收（实测每个会话第 1 轮第 1 步 400）。

## 9.2 多形态不用根级组合子

各形态字段写成可选属性，分支判定留在工具边界归一化函数（如 `normalizeQueryArgs`）。

## 9.3 回归只覆盖经 `apply()` 注册的工具

`test/apply-integration.test.mjs` 遍历 `apply()` 注册的全部工具断言以上不变量——新增工具
**必须经 `apply()` 注册**才在保护内。

## 9.4 改完 `src/` 必须重建并重启进程

`npm test` 先跑 build：宿主按 `lib/` 加载且 Node ESM 缓存模块——**要重启 dsh 进程**才生效。

## 9.5 ⛔ 返回值必须"无损 JSON"，`undefined` 不许带出

宿主 `snapshotJsonValue` 校验，自有属性 `undefined`（及 `NaN` / `Infinity` / `-0`、数组空洞、非
plain 对象）即整次失败。正确写法：条件展开（`buildProfile`）或单一收尾闸门（`describe.ts` 的
`compact()`）。回归：`assertLosslessJson()`（`test/describe-dataset.test.mjs`），新增工具测试照抄。

## 9.6 ⛔ 返回值必须满足自己声明的 `output.schema`

宿主逐次校验，违反即整次调用作废（账本 L16、探针 L16）。多形态唯一姿势：属性全可选、`required`
只列各形态共有信封、差异用 `enum` + 可选字段 + 各形态标记字段。判据：`required` 少一键即失败；
`jsonObject()` 默认 `additionalProperties:false`，**多返回一个未声明字段同样致命**。本地抓不到
（与 §9.5 同因：test 直调 `definition.execute` 绕过宿主校验、`JSON.stringify` 静默丢
`undefined`）——所以 `test/output-contract.mjs` 是宿主规则镜像断言：**改 `output.schema` 必须对
真实返回值逐形态断言**，并做**复刻事故形态**自检（临时漏字段，确认测试变红，否则闸门等于没写）。

## 10.1 测试与能力总表同步

`npm test` 全绿；新增 / 修改端点同步 `npm run docs:capabilities` 重新生成能力总表（测试断言文档
与实现一致，忘了生成会红）。

## 10.2 输出护栏必须先拿官方示例验证

护栏拒绝官方示例就是真实取数事故（曾发生 `fund_returns`）；改护栏时把官方示例写进回归测试
（位置见 `test/ths-rest.test.mjs` 对 `llm_full.md` 的引用）。

## 10.3 冒烟复核的 id 不得编造

有条件时跑 `npm run smoke:fuyao` 真实 REST 复核（护栏误杀应为 0）；冒烟的 `manager_id` /
`company_id` 必须从真实响应解析，**不得编造**（编造 id 返回 5003，是脚本问题不是上游故障）。

## 10.4 上游错误码的处置

`code=2004` = 同花顺客户端专用：不重试、不注册成 capability。`5003` = 上游数据源不可用，属数据
缺口，描述写明「不要反复重试」。

## 10.5 检索面新护栏同样要拿真报文验过

`check:dsh` 与单测只证明逻辑，不证明上游形状（冒烟记录见
`docs/design/web-retriever-source-expansion.md` 第 9.2 / 9.3 小节）。

## 10.6 行键名一律 ASCII snake_case（上游键名不许原样透传）

`normalizeKeyToken`（`src/data-collector/hub.ts`）只归一**内部 `data_key`**，不碰行字段名：上游键名
原样进 `raw.json`。而 `query_dataset` 的 `select` / `filters` / `group_by` 用字符串字面量点列名，
`query_type_conflict` 只在**类型**冲突时才响亮失败——键名里混进全角 `：`、`（）`、`％`（Wind 那类
带中文与冒号的键是恶劣版本）时，模型下一轮把它复现成半角就**匹配到零行、返回空**，而"空结果"和
"确实没数据"在回执里长一个样：错了不报错，只是话说错。

1. 进入 `data_collector` 的行键名必须是 ASCII `snake_case`。
2. 非 ASCII 或含分隔符的上游键名，在 producer 层用**显式映射表**改名。先例：
   `src/sources/eastmoney-http.ts` 把 `SECUCODE` / `CHANGE_RATE` / `TURNOVERRATE` 改成
   `thscode` / `change_pct` / `turnover_rate_pct`。
3. 映射不到的字段**丢弃，并把口径写进该能力的 `description`**，不许原样透传。要在回执里报
   `omitted` 之类的清单，先把机制实现出来再承诺——人设里写一个不存在的通道，就是「协议鼓励、
   宿主拒绝」那一类事故（§7 的 `final_report`）。
4. 全角 / 半角混排先在**真报文**上验过再写映射表（同一判据见 §10.2：猜错全半角等于静默空结果）。

## 10.7 参数归一化会被跑两遍：键名不许改，输出必须幂等

`normalizeParams` 不是"一次"：Hub 入队前调一次（merge key 与 params digest 都用规范化参数），
`createSource` 的 `execute` 内再调一次（直连调用也要生效）——`src/sources/fuyao-rest.ts` 把这条
写成注释"幂等"。两条硬要求由此而来：

1. **就地归一化**：只把**值**换成 canonical，**键名必须还是模型声明过的那个**。把 `ticker` 改名成
   行字段那套内部叫法 `thscode`（§10.6 第 2 条讲的是**输出**行键，不是参数——两者别混），第二遍
   `assertKnown` 就认不出它，报 `unsupported parameter: thscode`。2026-10-05 实测：四条东财 `ticker`
   能力的单票过滤全因此失效，且报错看起来像宿主所为。正确写法是本文件里先存的 `normalizeTicker`。
2. **幂等**：第二遍的输入就是第一遍的输出，必须原样返回。

两条由 `test/source-normalize-contract.test.mjs` 对**全部**已注册公开 HTTP 能力钉住（样例表覆盖数
必须等于注册数，新能力不补一行就失败）。它存在的理由是：原先那条幂等回归只手抄两条样例，而所有单测
都直接调 `source.execute`（只跑一遍），没有一条走过 Hub——所以 766 个测试全绿仍放过了真缺陷（§9.7
同一族：本地测试只覆盖了"接好的那个入口"）。

## 10.8 新增能力必须同时补巡检条目：四态之一，不许留空

> 落地物：`scripts/lib/contract-registry.mjs`（注册表）+ `test/contract-registry.test.mjs`（覆盖闸门）
> + `npm run contract:probe`（ runner，CI 在 `.github/workflows/data-source-contract.yml`）。
> 判据与取舍的论证在 `docs/design/data-source-contract-probe.md`；本节只放每次动手都要过的闸门。

`src/sources/*.ts` 里注册一条新能力，**同一次改动**就要在 `scripts/lib/contract-registry.mjs` 给它一行，
四态取一：`tier: 'daily'`（行情类、日频会变的）· `tier: 'weekly'`（基金档案 / 经理 / 回测这类静态面）·
`shadow`（已知从巡检视角测不了：照跑、留痕、不报警）· `excluded`（本仓刻意不接的东西）。


1. **由 `test/contract-registry.test.mjs` 钉，不靠人记**（与 §10.7 同一个先例）：注册数 == 覆盖数、
   每条恰好落进一个状态、`params` 能过该 source 的 `normalizeParams`、每条带 `budgetMs`。
   **漏一行就 `npm test` 红**——静默的缺席看起来像存在，还是 §9.7 那一族。
2. **`shadow` / `excluded` / 已知红白名单三类都必须带 `since` + 理由**，`shadow` 还要带 `revisit` 日期。
   没有出处的排除会一路烂到某天有人以为它正在被保护。
3. **巡检的字段判据复用 `validateOutput`，不许在巡检里重写第二份字段清单**（§9.6 是同一件事的另一半）。
   `GUARD` 失败 = 上游改了结构 = 改本仓映射表，这是整套巡检唯一真正值钱的信号。
4. 加新端点时顺手判一次它的失败**归哪类**：上游业务码（`2004` / `5003` 按 §10.4，不进 Issue）还是
   视角差异（机房 IP 被 WAF 挡，走 `shadow`）。两类混成一类，报出来的话就不可信。


## 10.9 改巡检状态怎么动手：一次提交就够，不用发版

三个旋钮都住在 `scripts/lib/contract-registry.mjs` 那一行里，**改它 = commit + push**：抬版本、打 tag、
发 npm 都不需要——巡检在 runner 上 `checkout` 仓库 master，而 `package.json` 的 `files` 里没有 `scripts/`。

| 想要的效果 | 怎么改 |
|---|---|
| 少打几次 | `tier: 'daily'` → `'weekly'`（只有北京周六那档全量打它）|
| 照打、不进结论也不开单 | 加 `shadow: { since, verdict, evidence, revisit }` |
| 本仓刻意不测 | 换成 `out()` / `dsOut()`（`excluded`，**不许带 tier**）|
| **这条能力被删了** | 生产与注册表**两边一起删**——覆盖闸门按注册数算分母；只删生产会红在"注册表指向不存在的能力"，正确答案是删掉那一行，**不是把能力补回去**。同时 `npm run docs:capabilities` 重生成总表（另有 `data-collector-capabilities` 守）；删空某家族要顺手从 `PROBE_FAMILIES` 摘掉 |

```js
ds('eastmoney', 'eastmoney_sector_rotation', 'daily', { page: 1, size: 3 }, {
  shadow: { since: '2026-10-08', verdict: 'HTTP_STATUS 502', revisit: '2026-12-01',
    evidence: 'hosted(Azure) 2/2 秒拒 502；国内出口同日曾 PASS——视角差异不是上游故障' } }),
```

`revisit` 是**到期日，不是"重置"**：闸门断言它不早于今天，到期就把 `npm test` 跑红，逼你回来定性
（转 active / 补新证据再续期 / 转 `excluded` 三选一），所以默默续期是违例。同一份测试还拦：`shadow`
缺 `revisit`；理由或证据写"同上"（短于 8 字被拒）；`excluded` 带 `tier`；`params` 过不了生产
`normalizeParams`；以及**删行**——覆盖闸门按注册数算分母，漏一行就红（§10.8 第 1 条同源）。

顺序：改 → `npm test` → `npm run contract:probe -- --only <子串>` 本地看判据落在哪 → `git push`。
排程：北京周一~周六 **04:00** = 一条 UTC cron `0 20 * * 0-5`（日档与全量档由 `resolveTier` 按北京星期分，周日不排）；改小时要连 `SCHEDULE_UTC` 一起改——有逐个"星期 + 小时"的回归比对拦住。
看门狗判的是**上一档**（`previousScheduledDue`）：实测 `schedule` 迟到 3~6 小时且没有上界，比谁先落地就是天天误报。想立刻验：`gh workflow run data-source-contract.yml -f tier=daily`。
**别为了"少报几条"标影子**：`TRANSPORT` / `SLOW` / `EMPTY` 本来就不开单（`ISSUE_VERDICTS` 只认
`GUARD` / `ENVELOPE` / `HTTP_STATUS`），影子的定义域是**这个视角测不准**——定性前先换个出口重打一次。
