# 工具 schema 与数据源验收（详情）

> 索引见仓库根 `AGENTS.md` §9 / §10。改模型工具定义（`parameters` / `output`）或
> `src/sources/fuyao-rest.ts` 之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间；通用判据
> §9.7（同一能力多入口）留在根，代码注释按 `AGENTS.md §9.7` 指过去。

## 9. 工具 schema 纪律（改任何模型工具定义之后）

### 9.1 `parameters` 根只能是 object

统一由 `jsonObject()` 构造 `{ type:'object', properties, required }`。根级 `oneOf` / `anyOf` /
`allOf` 或不写 `type` 会被供应商在第一个 token 前整体拒收（实测每个会话第 1 轮第 1 步 400）。

### 9.2 多形态不用根级组合子

各形态字段写成可选属性，分支判定留在工具边界归一化函数（如 `normalizeQueryArgs`）。

### 9.3 回归只覆盖经 `apply()` 注册的工具

`test/apply-integration.test.mjs` 遍历 `apply()` 注册的全部工具断言以上不变量——新增工具
**必须经 `apply()` 注册**才在保护内。

### 9.4 改完 `src/` 必须重建并重启进程

`npm test` 先跑 build：宿主按 `lib/` 加载且 Node ESM 缓存模块——**要重启 dsh 进程**才生效。

### 9.5 ⛔ 返回值必须"无损 JSON"，`undefined` 不许带出

宿主 `snapshotJsonValue` 校验，自有属性 `undefined`（及 `NaN` / `Infinity` / `-0`、数组空洞、非
plain 对象）即整次失败。正确写法：条件展开（`buildProfile`）或单一收尾闸门（`describe.ts` 的
`compact()`）。回归：`assertLosslessJson()`（`test/describe-dataset.test.mjs`），新增工具测试照抄。

### 9.6 ⛔ 返回值必须满足自己声明的 `output.schema`

宿主逐次校验，违反即整次调用作废（账本 L16、探针 L16）。多形态唯一姿势：属性全可选、`required`
只列各形态共有信封、差异用 `enum` + 可选字段 + 各形态标记字段。判据：`required` 少一键即失败；
`jsonObject()` 默认 `additionalProperties:false`，**多返回一个未声明字段同样致命**。本地抓不到
（与 §9.5 同因：test 直调 `definition.execute` 绕过宿主校验、`JSON.stringify` 静默丢
`undefined`）——所以 `test/output-contract.mjs` 是宿主规则镜像断言：**改 `output.schema` 必须对
真实返回值逐形态断言**，并做**复刻事故形态**自检（临时漏字段，确认测试变红，否则闸门等于没写）。

## 10. 数据源验收纪律（改 `src/sources/fuyao-rest.ts` 之后）

### 10.1 测试与能力总表同步

`npm test` 全绿；新增 / 修改端点同步 `npm run docs:capabilities` 重新生成能力总表（测试断言文档
与实现一致，忘了生成会红）。

### 10.2 输出护栏必须先拿官方示例验证

护栏拒绝官方示例就是真实取数事故（曾发生 `fund_returns`）；改护栏时把官方示例写进回归测试
（位置见 `test/ths-rest.test.mjs` 对 `llm_full.md` 的引用）。

### 10.3 冒烟复核的 id 不得编造

有条件时跑 `npm run smoke:fuyao` 真实 REST 复核（护栏误杀应为 0）；冒烟的 `manager_id` /
`company_id` 必须从真实响应解析，**不得编造**（编造 id 返回 5003，是脚本问题不是上游故障）。

### 10.4 上游错误码的处置

`code=2004` = 同花顺客户端专用：不重试、不注册成 capability。`5003` = 上游数据源不可用，属数据
缺口，描述写明「不要反复重试」。

### 10.5 检索面新护栏同样要拿真报文验过

`check:dsh` 与单测只证明逻辑，不证明上游形状（冒烟记录见
`docs/design/web-retriever-source-expansion.md` 第 9.2 / 9.3 小节）。
