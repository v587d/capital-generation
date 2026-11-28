# 2026-11 新增数据能力：契约巡检清单与转正计划

> 范围：本次数据面扩容新增的 **11 条 capability**（162→173）在 `scripts/lib/contract-registry.mjs` 里的巡检安排。
> 规则本体见 `docs/dev/tool-schema.md` §10.8/§10.9 与 `docs/design/data-source-contract-probe.md`；本清单只列这 11 条怎么落地、怎么转正、卡在哪。
> 状态基线：2026-11-28。全量档 186 条中 shadow 11 条（含本次 SEC 5 条）。
> **shadow 只是巡检不告警，不是生产未上线**：五条 SEC 已由 `createUsOfficialSources()` 注册进生产 Hub；是否转正只看巡检证据。

## 0. 一页结论

| 项 | 现状 |
|---|---|
| 本次新增条目 | 11（eastmoney 2、official 9） |
| 现在是 active | 6 条：东财港美股财务 2、Treasury、NY Fed、FINRA 成交量、FINRA 余额 |
| 现在是 shadow | 5 条：SEC 的 ticker_cik / filings / daily_filings / fulltext_search / market_frame |
| 卡点 | 本机直连 SEC 稳定 403；本机代理对 SEC/Treasury TLS reset。Treasury 直连可用，FINRA 代理可用 |
| 不需要改的东西 | 当前 11 条全部零 key；`PROBE_FAMILIES` / `FAMILY_ORDER` 不用改。若将来启用 `SEC_USER_AGENT` secret，要同步 workflow env |
| 转正状态 | **尚未转正**。SEC 真实 JSON 已核对，但 2026 实时 idx 仍被 403/422 阻塞；保持 shadow，revisit 仍为 2026-12-05 |

## 1. 清单总表

| # | capability | family | 档位 | 探针参数 | budget | 当前状态 | 已核对证据 | 待办 |
|---|---|---|---|---|---|---|---|---|
| 1 | `eastmoney_offshore_statements` | eastmoney | weekly | `secucode=AAPL.O, statement=balance` | 20s | **active** | 2026-11-28 直连/代理均 PASS（224/207ms）；完整 schema guard 已补 | 周档回归即可 |
| 2 | `eastmoney_offshore_indicators` | eastmoney | weekly | `secucode=00700.HK` | 20s | **active** | 2026-11-28 直连/代理均 PASS（855/915ms）；完整 schema guard 已补 | 周档回归即可 |
| 3 | `us_treasury_yield_curve` | official | daily | `start_date=dayShift(-30), end_date=dayShift(-1)` | **45s** | **active** | 直连 PASS 19.5s；代理 TLS reset。2026-11-01~25 基线 17 行 | 观察 full 档总时长；若 CI 明显较慢再抬 budget |
| 4 | `nyfed_reference_rates` | official | daily | `rate=sofr, start_date=dayShift(-30), end_date=dayShift(-1)` | 20s | **active** | 2026-11-28 直连/代理均 PASS（365/875ms）；SOFR 基线 16 行 | 无 |
| 5 | `finra_short_volume` | official | daily | `{}`（省略日期自动发现最近已发布日） | 20s | **active** | 代理 PASS 1.25s；直连 TRANSPORT 5.44s。2026-11-25 文件 12,376 行 | 每周抽查一次「当天未发布」回退路径 |
| 6 | `finra_short_interest` | official | weekly | `symbols=['AAPL']` | **30s** | **active** | 代理 PASS 1.53s；直连 TRANSPORT 5.48s。2026-11-13 结算日 1 行 | 自动发现已改为按全部 symbols 判定；双周结算日切换后复核 |
| 7 | `sec_ticker_cik` | official | weekly | `tickers=['AAPL']` | 20s | shadow | 直连 403、代理 TLS reset；宿主出口核对 `company_tickers.json`；已补 `found=true` identity | 换出口跑 PASS 后转正 |
| 8 | `sec_filings` | official | weekly | `ticker=AAPL, limit=5` | 20s | shadow | 直连 403、代理 TLS reset；真实 submissions `recent` 列式数组已核对 | 保持 recent-only 范围；换出口 PASS 后转正 |
| 9 | `sec_daily_filings` | official | weekly | `filing_date=dayShift(-1)` | 20s | shadow | 真实 idx 证实定宽表头可跨两行、日期为 `YYYYMMDD`、目录为 `QTR4`；解析/路径已修并补 fixture；2026 实时 idx 仍被 403/422 阻塞 | **2026 实时 idx 复核后才可转正** |
| 10 | `sec_fulltext_search` | official | weekly | `q='"apple"', forms=['8-K'], limit=3` | 20s | shadow | 直连 403、代理 TLS reset；真实 `_id`/`_source.adsh` 已核对；已补 `form=8-K` identity | 换出口跑 PASS 后转正 |
| 11 | `sec_market_frame` | official | weekly | `tag=Assets, unit=USD, period=CY2025Q1I` | **40s** | shadow | 真实 `pts=5655`；instant/duration 真报文与 fixture 都已覆盖 | 换出口跑 PASS 后转正 |

> 档位口径：`daily` = 每日档（北京周一~周五）；`weekly` = 只在周六全量档打。SEC 全部 weekly，避免每日对 SEC 发请求。

## 2. 判据：一条巡检怎么算「过」

| 判定 | 含义 | 是否开 Issue |
|---|---|---|
| `PASS` | HTTP 正常、`validateOutput` 与 `output_schema` 一致、行数满足 `expect.minRows`、identity 命中、耗时 ≤ budget | 否 |
| `SLOW` | 结果对但超 budget（只影响报表） | 否 |
| `EMPTY` | 成功但 0 行（如非交易日、未发布日） | 否（但要人看趋势） |
| `TRANSPORT` | 网络/TLS/代理层失败 | 否 |
| `HTTP_STATUS` | 上游返回非 2xx（SEC 的 403 属此类） | **是** |
| `GUARD` | 出参数组/字段/类型与生产契约不符，或已解析信封结构错误 | **是** |
| `ENVELOPE` | 外层形状（`item`/数组）与 `rowShape` 不符 | **是** |

`ISSUE_VERDICTS = [GUARD, ENVELOPE, HTTP_STATUS]`。**shadow 的意义是「这个视角测不准」，不是「结果不好看」**：
SEC 的 403 属 HTTP_STATUS，出口恢复前若不挂 shadow 就会每天开单；但挂 shadow 的前提是「本机视角测不准」，
一旦换到能正常访问的出口仍失败，就必须按 §4 转成 active 并修，不能继续续影子。

结构错误不许再落进 `TRANSPORT`：`sec_invalid_response` / `us_official_invalid_response` /
`eastmoney_invalid_response` 现在一律归 `GUARD`。`finra_not_published` 归 `EMPTY`。

## 3. 转正 SOP（shadow → active）

前提：在**能正常访问 SEC 的出口**（CI runner，或换网络的本机）执行。

1. **跑全量档但这 5 条**：
   ```bash
   npm run build
   node scripts/contract-probe.mjs --tier full --only sec_ --json /tmp/sec.json --markdown /tmp/sec.md
   ```
2. **按结论分支**：
   - 全部 `PASS`，且每条都满足 `expect.minRows` / identity → 进入第 3 步；
   - `GUARD` / `ENVELOPE` → **先改映射再转正**：按真实响应修 `src/sources/sec-http.ts` 的字段映射与 `validateOutput`，
     同一条改动里补 `test/sec-source.test.mjs` 的 fixture，再重跑；
   - `HTTP_STATUS 403` 仍出现 → 说明出口还是被拦，保持 shadow，更新 evidence 并给新 revisit（≤30 天），
     **不许只改日期不加证据**；
   - `TRANSPORT` → 分清是出口还是 DNS/TLS；换出口复测后再定性。
3. **转正 = 删掉该行的 `shadow` 字段**（保留 `tier`、`params`、`budgetMs`、`expect`），一次提交即可，
   **不用发版、不用打 tag**（`scripts/` 不在 npm `files` 里，巡检在 runner 上 checkout master）。
4. **本地回归**：`npm test`（覆盖闸门按注册数算、revisit 必须不早于今天、shadow 必须带 since/evidence/revisit）。
5. **CI 侧复核**：`gh workflow run data-source-contract.yml -f tier=full`，在报告里确认这 5 条从「影子」变成「合格」。

## 4. 转正前证据：已补什么，仍缺什么

### 4.1 `sec_daily_filings` idx：发现并修复真实格式差异，但实时文件仍未拿到

本轮从 SEC 2018-12-31 真实索引摘录确认：定宽文件的表头**可以跨两行**：

```text
Form Type   Company Name                                                  CIK
      Date Filed  File Name
```

旧实现要求 `Form Type` 与 `File Name` 出现在同一行，因此会直接报 `has no header row`；
真实行的申报日还是 `YYYYMMDD`，旧实现只认 `YYYY-MM-DD`。同时还确认 SEC 目录名是 `QTR4`，不是 `Q4`，
旧 URL 即使出口恢复也会 404。现已改为：从 `Form Type + Company Name` 起收集表头，直到分隔线；
pipe 与定宽都按列名解析；申报日两种写法都接受并统一输出 `YYYY-MM-DD`；季度路径统一用 `QTR{季}`。
真实摘录已写入 `test/sec-source.test.mjs`。来源：[SEC 索引文件实读摘录](https://tanyaschlusser.github.io/py-kind-of-town/)；
2026 年目录与 `form.20261125.idx` 的存在由 [SEC QTR4 官方目录](https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/) 核对。

**仍缺 2026 实时 idx**：本机直连 403，代理 TLS reset，宿主提取器对 `.idx` 返回 422。
2018 fixture 只能证明历史定宽分支，不能替代当前文件复核；因此 `sec_daily_filings` 继续保持 shadow。

### 4.2 `sec_filings` 历史 `files`：确认存在，但本能力刻意保持 recent-only

SEC 官方 API 文档确认：`filings.recent` 至少包含最近一年或 1,000 条（取多者），更早申报在
`filings.files` 指向的附加 JSON 中。真实 Apple / CBRS submissions 也已核对列式数组。

本能力描述与输出契约承诺的是**最近申报清单**，不承诺全历史；自动合并 `files` 会引入额外分页请求、
`limit` 语义和延迟预算。本轮决定**不补合并**，保留 recent-only，并在描述中明确历史边界。
需要更早历史时用 `sec_daily_filings` / `sec_fulltext_search`，不要把 recent 的空缺当成“没有申报”。

### 4.3 其它 SEC fixture

- `sec_ticker_cik`：真实 `cik_str/ticker/title`。
- `sec_fulltext_search`：真实 `_id` 与 `_source.adsh/ciks/display_names`，优先走 `adsh`。
- `sec_market_frame`：真实 instant 与 duration 两分支；旧清单“fixture 已覆盖 duration”不准确，现已补齐。

## 5. 出口与凭据前提

| 前提 | 2026-11-28 实测 | 动作 |
|---|---|---|
| SEC 直连 | `www.sec.gov` / `data.sec.gov` / `efts.sec.gov` / daily-index 全部 HTTP 403 | 换出口或在 CI 复测；保持 shadow |
| SEC 代理 | `127.0.0.1` 代理在 TLS 建连前 `ECONNRESET` | 不用代理结论替代直连结论 |
| Treasury | 直连 HTTP 200，18.5s TTFB / 巡检 19.5s PASS；代理 TLS reset | 保持 45s budget，观察 CI |
| FINRA | 代理 PASS；直连 `fetch failed`（约 5.4s） | 巡检结论必须带出口视角 |
| SEC UD/UA | 常量 `capital-generation (+https://github.com/v587d/capital-generation)`，可用 `SEC_USER_AGENT` 覆盖 | 若 SEC 要求 contact email，登记 CI secret 并同步 workflow env；当前未配 |
| BLS/DOL contact | 未接入，无条目 | 接入时按 §10.8 补 registry，BLS 需 UA/署名、DOL 需 POST |
| 凭据 | 本次 11 条全部零 key | workflow 的 `FAMILY_SECRET` 映射不用改 |

## 6. CI 运行面（本清单不改 workflow 行为，只登记事实）

- 档位：`daily` 140 条 / `full` 186 条，其中 shadow 分别 3 / 11；本次新增 11 条中 **3 条**每日档会打
  （Treasury / NY Fed / FINRA 成交量），**8 条**只在周六全量档打（东财 2、FINRA 余额 1、SEC 5）。
- family：本次全部落在既有 `eastmoney` 与 `official` 两个家族，`PROBE_FAMILIES` / `FAMILY_ORDER` 不用改。
- 预算：`official` 家族本次新增里最长的是 Treasury（45s）与 frames（40s）；`official` 全量 12 条串行，
  必要时观察 full 档整体时长是否逼近 25 分钟 job 上限。
- 失败通道：红 = 我方工具/注册表问题；Issue = 上游问题。SEC 转正后若仍 403 会进 Issue，这是预期行为。

## 7. 风险与红线

1. ⛔ **不许为了少开单把 active 降级成 shadow**：shadow 的定义域是「本视角测不准」，不是「上游偶尔抖」。
2. ⛔ **revisit 是到期日，不是重置键**：到期不处理 `npm test` 必红；三选一（转 active / 补新证据续期 / 转 `excluded`）。
3. ⛔ **不许把 EMPTY 当失败去改参数**：`finra_short_volume` 的「当天未发布」、`nyfed` 的周末空区间都是合法空。
4. ⛔ **不许在巡检里重写字段清单**：判据复用生产 `validateOutput` + `output_schema`；本次 11 条护栏已补齐
   required / additionalProperties / 类型 / nullable 检查。
5. ⛔ **不许拿本机代理视角的结论当 CI 结论**：FINRA 本机直连失败、代理 PASS；Treasury 直连 PASS、代理 TLS reset。
6. ⛔ **结构错误不许归 TRANSPORT**：解析成功后的信封/列/行形状错误是 `GUARD`，否则上游改结构会长期假绿。
7. ⛔ **SEC 的 `expect.minRows` / identity 不许删**：空数组或 `found=false` 不算转正证据。

## 8. 时间表

| 时间 | 事项 | 负责人 |
|---|---|---|
| 2026-12-05（revisit 到期前） | 在 CI/其它出口跑 `--only sec_`；拿到 2026 实时 idx；按 §3 转正或补证据续期 | 待定（下次 CI session） |
| 转正同一次提交 | 确认五条均非空、identity 命中、schema guard 通过；保持 `sec_filings` recent-only 决定 | 同上 |
| BLS/DOL 接入时 | 按本清单同一模板补条目（BLS 需 contact + 署名、DOL 需 POST XML） | 同上 |
| Form 4/13F 实现时 | 先拿真实申报 XML 核对解析，再按 §10.8 补 registry | 同上 |

## 9. 不在本清单

- BLS / DOL：尚未实现，registry 里没有条目（实现后按 §1 模板补一行）。
- Form 4 / 13F：尚未实现（需要真实申报 XML 样本做护栏核对）。
- 存量 shadow（`eastmoney_security_profile` 等）：不属本次范围，沿用各自 revisit。

## 10. 2026-11-28 执行记录

- 已构建并双出口复跑 11 条：6 条 active 在至少一个出口 PASS；SEC 5 条直连全部 403、代理全部 TLS reset。
- 已修：SEC 跨行定宽 idx、`YYYYMMDD` 日期归一与 `QTR{季}` 路径、11 条完整 schema guard、结构错误分类、
  SEC 非空/identity、FINRA 多票自动发现、Treasury 1830 天参数上限、真实 SEC fixture（含 duration）、文档入库忽略规则。
- `npm test`：**1919/1919 通过**；`git diff --check` 通过。
- 未做：SEC 转正、GitHub Actions 实跑、2026 实时 idx 获取；原因分别为出口阻塞、本机未登录 `gh`、提取器 422。
