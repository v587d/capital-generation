# 数据源每日契约巡检（design / v3 · 已落地）

> 状态：**已实现**。注册表 `scripts/lib/contract-registry.mjs`、覆盖闸门
> `test/contract-registry.test.mjs`、runner `npm run contract:probe`、CI
> `.github/workflows/data-source-contract.yml` + 看门狗。本文保留为**论证与实测记录**——
> 判据为什么这么定、哪些假设被推翻，这些不会从代码里读得出来。
> 目标一句话：每天早上 07:00（北京时间）把指定数据源的 HTTP 端点各打一次最小请求，按
> **状态 / 响应时间 / 核心字段** 三条判据判一个结论，不合格就把可读的报错开成 GitHub Issue。
>
> ⚠️ 落地后调整（2026-10-11）：**所有档位实际是北京 04:00**（UTC 前一天 20:00），工作日与周六共用同一个
> UTC 小时，所以两条 cron 并成了一条 `0 20 * * 0-5`；档位仍由 `resolveTier()` 按北京星期分（周六全量）。
> 本文其余各处写的 07:00 / 06:00 都按 04:00 读——排程真值只有 workflow 的 cron 与注册表里的
> `SCHEDULE_UTC` 两处，两边由回归逐个「星期 + 小时」比对钉住。改点原因见 §11.5 第 7 条。


### 0.0 已定的五个取舍（2026-10-08 拍板）

| 事项 | 决定 | 后果（要认的部分） |
|---|---|---|
| 网络视角 | **只用 GitHub hosted**，不做国内 self-hosted（无此类机器，接 Gitee 太重） | 巡检降级成**契约/结构看门狗**，不再是**可达性 SLO**——只有国内出口才看得见的故障抓不到（§1.2） |
| 不可测的能力 | **影子模式**：照跑，结论记 `EXCLUDED_SHADOW`，不进 Issue | 每天多几个请求，换「排除项是可审计事实」而不是靠记性（§3.2） |
| 告警阈值 | **只有结构/状态级失败开 Issue**（`GUARD` / `ENVELOPE` / `HTTP_STATUS`），网络抖动只进 summary | 海外机房 IP 的 `TRANSPORT` 噪声不报（§7.1） |
| 巡检没跑 | **单独一个 watchdog workflow** 检查昨天那次跑没跑 | 两个独立调度器，其中一个才发现另一个死了（§5.3） |
| 缺 key | **开工前一次性检查，缺就 job 红、一个请求都不发** | 红 = 我们的工具有问题；Issue = 上游有问题。两个信道不混（§6.4） |

## 0. 先说结论：初始假设被实测推翻了两条

设计前我先拿真环境做了两次实验（一次在本机，一次把一次性探针推到 GitHub hosted runner 上跑完就删分支）。
下面这些是**实测数字**，不是推断——它们改变了方案形状。

| 假设 | 实测结果 |
|---|---|
| 「中国站点不会应答海外 IP，hosted runner 大概全是误报」 | **推翻**。20 个上游主机 23/23 全部可达，包括腾讯、东财、财联社、互动易、新浪、同花顺基本面。 |
| 「国内视角和海外视角看到的应该一样」 | **推翻**。两边都能连通，但**判据结论不一样**，而且差在一个要命的地方（见 §1.2）。 |
| 「第三方没有 schema.json，所以要我们自己定契约」 | 半对：**契约在本仓已经存在且已有两道强制**（`output.schema` + `validateOutput`，Hub 在 `src/data-collector/hub.ts:501` 落盘前执行）。要新增的不是契约，是**契约的巡检**。 |

顺带查出两件 presently 有用的小事，一并写在这里，因为它们本身就是这套东西要抓的东西：

- **`push2.eastmoney.com/api/qt/clist/get` 从本机出口连不上**：`UND_ERR_SOCKET`，5/5 次，去掉 `ut`
  也失败、换 `push2delay` 也失败、同一台 `push2` 的 `stock/get` 却 175ms 正常 200。海外视角反而正常
  （302 → `push2delay` → `rc=0`）。
  **用户判断**：本机当时走的是星巴克公共网络，那类出口 IP 大概率已被东财按 IP 信誉封掉，换出口即可。
  本方案照此接受：`TRANSPORT` 级失败不进 Issue（§7.1），hosted 巡检通过就算正常。
  保留一件仪器而不是一项监控：国内出口随时可以手动复跑（§5.4），出事先拿仪器量一下再决定要不要当真。
- **AnySearch 不带 key 也能搜**（两个视角都 `code=0` 带回真结果）。这条见 §7.3 坑 3：缺 key 会被巡检记成 PASS。


---

## 1. 实测：两个网络视角的对照

- **A 视角**：本机，出口 `220.196.226.114`（上海联通，AS17621，住宅/企业宽带）。
- **B 视角**：GitHub hosted `ubuntu-latest`，出口 `20.83.175.155`（**美国 Azure Dulles，AS8075**）。
- B 视角的探针是一次性分支 `probe/net-vantage` 上的 workflow，跑完已删分支与本地 worktree；
  仓库工作区未被触碰（当前 WIP 改动仍在）。

### 1.1 全景对照

| 项 | A｜上海联通 | B｜Azure 美东 | 对方案的影响 |
|---|---|---|---|
| 端到端延迟中位 | **155 ms** | **1176 ms**（≈7.6×） | 响应时间阈值**不能是常数**，必须按视角标定（§2.4） |
| `push2 clist/get`（板块/资金流） | ❌ RST 5/5 | ✅ 302→`push2delay`，`rc=0` | 见 §1.2，这是全篇最重要的一条 |
| `sns.sseinfo.com`（上交所互动） | ✅ 200，HTML 11.5 KB，3/3 稳 | ❌ **403 WAF**，3/3 稳，body 769B | 海外视角每天误报这个源坏了 |
| `push2 stock/get`（单票存在性检查） | ✅ 200 `rc=0` | ✅ 302→`push2delay` | 同主机**分路径**判定，别整主机一票否决 |
| `vip.stock.finance.sina.com.cn` | 302 → `http://stock.finance.sina.com.cn`（**换主机 + 降级 http**） | 同样 | 断言只能落在**最终 URL 与正文形状**上 |
| `basic.10jqka.com.cn/new/600519/worth.html` | 301 → `http://basic.10jqka.com.cn/600519/worth.html`（32 张表，EPS/均值都在） | 同样 | 同上；`local-fetch.ts:564-581` 本来就是手动逐跳重定向，行为一致 |
| `fuyao` 不带 key | HTTP **200** + `code=2003` | 同（87 ms vs 1158 ms） | 无凭据也能验证「路由活着」，但 **2003 不是 2001**（§6.3） |
| `anysearch /v1/search` 不带 key | **200 `code=0` + 真结果** | 同 | 缺 key = 假绿（§7 坑 3） |
| `anysearch /v1/extract` 不带 key | **422** + `error_code` | 同 | 先校验 URL 再校验鉴权，探针参数要合法才有意义 |
| `mcp.wind.com.cn` initialize 不带 key | — | **401** | 免费判 Key 与协议是否还在 |
| `paddleocr` GET `/api/v2/ocr/jobs` | — | **405**（POST-only） | 路由活着；真端到端要上传文件，不进日常（§9.4） |

### 1.2 单视角放弃了什么——这条要说白，别让它含糊进实现

双视角本来能分开四类信号（这是实测前想不到的）：

| 国内 | 海外 | 结论 |
|---|---|---|
| ❌ | ❌ | 上游真的坏了/改版了 |
| ❌ | ✅ | **只有国内出口看不见了**——ISP / IP 信誉 / 路由 |
| ✅ | ❌ | 海外被风控，产品实际用户不受影响 |

只留 hosted 视角，等于**只保留第一列的判断能力**，后两类一律看不见。具体代价就两条：

- `push2 clist/get` 这类**只在特定出口发生的故障**，巡检会天天 PASS 而用户天天踩。
  用户已明确接受这条（并按 IP 信誉解释了它），本方案的处理方式不是假装它不存在，而是：
  **①把 hosted 巡检定位成"契约/结构看门狗"而不是"可达性 SLO"**（写进 README，也写进 §10 不做清单）；
  **②把国内复跑留成一件随手仪器而不是一个监控**（§5.4）——出事时先量一下再决定要不要当真。
- **`push2delay` 的含义**：海外流量被 302 到的是**延迟镜像**。也就是说 hosted 视角下凡走 `push2` 的能力，
  拿到的都是延迟报价。对契约巡检（形状、字段、code）毫无影响——**这是好事**，形状检查不需要实时。
  但由此得一条硬约束：⛔ **巡检不许对 `eastmoney_sector_rotation` / `eastmoney_cashflow_rotation` /
  `eastmoney_main_capital_snapshot` 这类 `push2` 系能力做任何"数据新鲜度"断言**，
  那在海外视角下必然测到延迟数据，会把一个正确的实现判成失败。

视角差异不会消失，它只会变成 Issue 里一句没人看得懂的话——所以 §7.2 的正文里
必须固定写一行「本次结论仅代表 `<egress IP + ASN>` 视角」，把局限写在脸上。

这正是 §10 里「任何新护栏先拿官方示例/真报文验过」那条纪律在运维面的对应物：不实测就没有资格下结论。
反过来说，**这次实测也直接把"要不要国内视角"这个问题从猜测变成了标价**——现在知道它值什么，
放弃它就是有意识地放弃，而不是没想到。

---

## 2. 「最小契约」到底指什么

用户给的边界是：**HTTP 状态、响应时间、核心字段**。我建议在这三条之外再加两条，因为它们是本仓
已经付过学费的东西；但**不加**任何需要新存储、新服务的东西。

### 2.1 三道判据落在仓库既有资产上，不新建契约

| 判据 | 怎么判 | 复用了什么 |
|---|---|---|
| **状态** | 传输层异常与 HTTP 状态分类；业务信封的 `code` / `rc` / `errno` / `success` | 各家**已有**错误分类：`fuyao-core.ts:79-99`（`2004` 能力关闭 / `4001` 限流 / `5003` 数据缺口 / `1002`·`1003` 参数）、`eastmoney-http.ts:132`（429）、`tencent-public-core.ts:73`（429）、`wind-client.ts:87-95`（401/429/5xx） |
| **响应时间** | 每端点一个预算，超时与「慢但成功」分开记 | 生产超时口径已有：Hub 30 s（`hub.ts:235`）、Wind 数据面 12 s（`wind-mcp.ts:31`）、AnySearch 60 s（`engines.ts:93`） |
| **核心字段** | **直接调 `source.validateOutput(data)`**，不重写字段清单 | Fuyao 是逐能力的 `buildGuard`（`fuyao-rest.ts:2083`），东财是 21 个能力共用一条 `item + pagination`（`eastmoney-http.ts:1135`），腾讯按能力切（`tencent-http.ts:757-760`），Wind 刻意只查形状（`wind-mcp.ts:529-530`） |

这条是整个方案的支点。理由：**契约向第三方要不到，但本仓不是没有契约**——`docs/dev/tool-schema.md` §9.6 已经规定
「返回值必须满足自己声明的 `output.schema`」，`hub.ts:501` 已经在落盘前强制 `validateOutput`。
巡检要做的是**每天把这道闸门到真报文上过一遍**，而不是再抄一份字段清单。

一旦再抄一份，就有了第二份真相，它必然漂移——这是 §9.7 那一族事故（「同一能力接多个入口，
本地测试只覆盖了接好的那个入口」）的运维版。所以：

> ⛔ **契约的唯一来源是 `lib/` 里的 `DataSource` 对象本身**。探针 `import` 生产的
> `createFuyaoRestSources()` / `createEastmoneySources()` / `createTencentSources()` 和生产的
> `clsTelegraph() / sinaReports() / …`，走 `execute()` 与 `validateOutput()`。
> 探针里**不许出现第二份 URL、第二份字段名列表**。

好消息是这条路已经趟过：`scripts/smoke-fuyao.mjs` 就是这个形状（遍历全部注册 capability、
用最小参数打真请求、同时打印上游 `code` 与 `validateOutput` 判定、缺参数表就**报错并点名**，
`:99-103`）。方案 = 把它的参数表与判定逻辑抽成多数据源通用，而不是另起一套。

### 2.2 建议加的第四、第五条判据

- **④「空」与「坏」必须分开。** 0 行是**合法成功**：`wind-mcp.ts:539` 记着实测「非交易日快回 0 行、653 ms 空表」，
  而「该日该市场分钟尚未落地」与「上游挂了」在线上**都表现为挂到超时**。腾讯更狠——空 `data` 本身
  就是被风控的症状之一（`tencent-public-core.ts:17-21` 原文：「429 / 空 data / 静默限流」）。
  所以 `EMPTY` 必须是独立判据，默认**不红色**。
  推论：07:00 每天跑意味着周六周日也跑，那两天一堆空表——不加这条就每周多两天假警报。
  再进一步：巡检自己**先问一次 Fuyao `trading_calendar`**（一次请求，几乎免费），把「今天是不是 A 股交易日」
  当作其它端点 `EMPTY` 的解释变量写进 Issue 正文。
- **⑤「首次失败日期 / 连续第 N 天」。** 数据不另存，从同 label 的未关闭 Issue 数量推。
  「今天红了」和「这已经是我们知道的第 9 天」是完全不同的紧急度。

### 2.3 判据闭集（每条结论必须落进其中之一）

「开不开 Issue」是判据表上**唯一真正重要的一列**——它决定这套东西第三周还在不在被人看。

| 判据 | 含义 | **开 Issue?** | 备注 |
|---|---|---|---|
| `PASS` | 状态、时延、护栏、行数全合格 | 否 | |
| `GUARD` | **`validateOutput` 返回 false** | **是（最高）** | 唯一能证明「上游改了结构」的信号，这就是用户要的「核心字段」 |
| `ENVELOPE` | 上游业务 code ≠ 0，**带 code 原值** | **是**（白名单除外） | `5003` 数据缺口、`2004` 能力关闭 进基线不报（§7.1） |
| `HTTP_STATUS` | 4xx / 5xx | **是** | 403 且能归因于海外机房 IP 信誉的 → 走影子（§3.2），别当契约失败 |
| `TRANSPORT` | DNS / TCP / TLS / 超时 | **否**，只进 summary | hosted 是**共享轮换的 Azure 机房 IP**，这类噪声本来就不可信；`push2 clist` 属此类 |
| `EMPTY` | 形状对、护栏过、0 行 | 否（交易日升高） | 与 `trading_calendar` 联动；07:00 含周末，不加这条就每周两天假警报 |
| `SLOW` | 成功但超预算 | 否，只进 summary | 阈值待实测校准（§2.4），初期一定偏 |
| `EXCLUDED_SHADOW` | 已知从本视角不可测，照跑并留痕，不计入结论 | **否** | 见 §3.2；这是 `sseinfo` 与 `analytics_data` 的归宿 |
| `SKIPPED` | 依赖 id 解析不出 | 无 | ⛔ **绝不用编造 id 凑一次调用**（§10.3：编造 id 得 `5003`，那是脚本问题不是上游故障） |

`GUARD` 单独提到最高优先级，理由很直接：其它类都可能是一次网络抖动，**只有 `GUARD` 意味着代码需要改**。
`eastmoney_sector_rotation` 这类 `TRANSPORT` 故障用户看一眼就知道等会儿再试；`GUARD` 故障放着不管会一直错。

⛔ **缺凭据不是 `SKIPPED`。** `SKIPPED` 只留给「真实 id 解析不出来」这一种。
secret 缺失/过期属于 §6.4 的开工前闸门，job 直接红、一个请求都不发——
因为 `AnySearch` 实测**不带 key 也返回 200 和真结果**，一旦让它跑起来就是假绿。

### 2.4 响应时间阈值不写死

今天拿到的样本太少，不足以定常数：国内出口 16 个点 p50 155 ms（两个离群是 `tencent_ticks` 4563 ms
因为它翻页、`wscn_lives` 2832 ms），hosted 出口 p50 **1176 ms**。⚠️ **巡检只有 hosted 视角，
所以标定只能拿 hosted 的数字做**——别拿本机那组 155 ms 去填注册表，那会造出一个每天必超的预算。

做法：每条先填一个**保守初值 20 s**，跑第一次全量 `workflow_dispatch` 时按实测 P95 回填，
并在注释里写「此数来自 `<日期>` 的 `<sha>` 巡检，hosted 视角」。`SLOW` 只是 summary，
所以初值偏大不产生假警报，偏小才产生——那就先偏大。凭今天的数把预算写死，
等于给自己造一个每周红一次的假警报。

---

## 3. Registry：唯一的真相源长什么样

一个新的 `scripts/lib/contract-registry.mjs`，一条能力一行。它是**数据**而不是框架，所以读起来应该
像一张表：

```js
// tier: daily 每天 07:00 跑；weekly 周六全量跑。
// budgetMs: 延迟预算（hosted 视角，初值一律 20000，实测后回填 —— §2.4）
// secret: 该条依赖哪个 secret 名；开工前闸门据此检查（§6.4）
{ source: 'fuyao', capability: 'quote', tier: 'daily', secret: 'FUYAO_API_KEY',
  params: { thscodes: '600519.SH' }, budgetMs: 20_000,
  expect: { minRows: 1, identity: { field: 'thscode', value: '600519.SH' } } }

{ source: 'eastmoney', capability: 'eastmoney_cpi', tier: 'daily',
  params: { start_date: '2025-01-01', end_date: '2026-09-30', page: 1, size: 3 },
  budgetMs: 20_000, expect: { minRows: 1 } }

// 依赖真实 id 的：resolve 失败必须 SKIPPED，不是 FAIL（§10.3）
{ source: 'fuyao', capability: 'fund_manager', tier: 'weekly', secret: 'FUYAO_API_KEY',
  requires: 'manager_id', resolveFrom: { capability: 'fund_profile', path: 'item.0.manager_info.0.manager_id' },
  budgetMs: 20_000, expect: { minRows: 0 } }

// 已知从本视角测不了的：照跑、留痕、不进结论（§3.2）
{ source: 'sseinfo', capability: 'sseinfo_qa', tier: 'daily', shadow: {
    since: '2026-10-08', verdict: 'HTTP_STATUS 403',
    evidence: 'hosted(Azure AS8075) 3/3 稳定 403 WAF；国内出口 3/3 稳定 200 + 11.5KB HTML',
    revisit: '2026-12-01' } }

// 结构性不测的：连请求都不发（§10）
{ source: 'wind', capability: 'analytics_data', excluded: {
    since: '2026-10-05', reason: '实测连 initialize 都挂满 60 秒，本仓刻意未接（wind-client.ts:21-22）' } }
```

四个设计要点，都不是风格问题：

1. **`expect.identity`：请求了 600519 就要拿回 600519。** 光看「HTTP 200 + 有行」不够——本仓最贵的
   两次静默事故都是「返回了东西，但不是你要的那个东西」：`sseinfo` 实测 `600519` 的 questions 底下
   混进过 `600518` 的条目（`web-retriever/sources.ts:668-681`，所以现在逐行过滤并把丢弃数写进 `note`），
   `cninfo_irm` 的 `600519.SH` 会合法地 `NOT_FOUND`（它只覆盖深市，`sources.ts:383`）。
   再加一条：§10.6 说明键名必须是 ASCII snake_case，而「键名混进全角字符」的表现正是
   **匹配到零行且不报错**，所以核心字段判据要看**键名清单**而不是只看有没有行。
2. **静态样本日期必须显式。** Fuyao 的 `history` 参数在 `smoke-fuyao.mjs:32` 用
   `Date.UTC(2025,0,2)–Date.UTC(2025,1,28)` 这种写死的区间——很好，可复现。但
   `hot_stock_history: {date: '2026-06-21'}` 这类会随上游只保留近期数据而变成合法的 `EMPTY`。
   注册表要区分 `固定历史窗口` 与 `相对今天`，后者要写清相对量，否则某天红掉是因为日历不是因为上游。
3. **覆盖完整性由 `npm test` 钉住，不靠人记。** 现成先例两条：`smoke-fuyao.mjs:99-103` 缺参数表直接
   `process.exit(2)` 并点名；`test/source-normalize-contract.test.mjs` 要求「样例表覆盖数 == 注册数，
   新能力不补一行就失败」。新测试沿用后者，并多钉四条：每条能力**恰好属于一个 tier（或 `shadow` /
   `excluded` 之一）**、每条 `params` 能过该 source 的 `normalizeParams`（顺带把 `assertKnown` 的拼写
   错误在 CI 静态阶段就抓出来）、每条都有 `budgetMs`、**每个 `shadow`/`excluded` 都带 `since` +
   `reason`/`evidence`**。这样「加了新端点但巡检漏了它」在 push 时就红，而不是等到某天用户踩到。
4. **⛔ 三态互斥，且必须能被 grep 出来**：一条能力只能是 `daily` / `weekly` / `shadow` / `excluded`
   之一。这个枚举不是为了整齐，是为了让「这条我们到底测不测」变成一个**写在仓库里的事实**——
   §9.7 那次 61 颗同花顺能力静默不注册、整场进程不重试，教训就是"静默的缺席看起来像存在"。

### 3.2 `shadow`（影子模式）与 `excluded` 的区别——这是用户问的那个 exclude 的正解

用户的诉求是「国内财经端口稳定报 WAF，我只能放弃巡检这个能力，默认它有效」。
直接 `delete` 掉这一行会丢掉两样东西，所以方案把它拆成两级：

| | `shadow`（影子） | `excluded`（排除） |
|---|---|---|
| 发不发请求 | **发** | 不发 |
| 结论进不进 Issue | 不进，只进 workflow summary 与 artifact JSON | 不进，只在注册表里留一行理由 |
| 什么时候升级成告警 | 它哪天不再 403、或开始报 `GUARD`，**shadow 到期复核时看见** | 手工改注册表 |
| 用在哪 | **视角造成的、但不是上游的问题**：`sseinfo` 海外 403 | **本仓刻意不接的东西**：`wind analytics_data`（`initialize` 挂 60 s） |

三个理由，按重要性排：

- **一个会喊的假警报，代价是之后所有真警报。** 所以「不再拿它当告警」是对的诉求。
  但「不报」和「不看」是两件事：影子模式把这条从**告警通道**挪到**观测通道**，噪声为零，信息还在。
- **注册表 + `npm test` 会持续暴露一个事实：`shadow` 项一直没变成 `PASS`。** 反过来，如果哪天上游
  解除了对机房 IP 的风控，影子结论变绿，你会在 summary 里看见——不必重新加回来再等一周。
  彻底删除则永远是黑的，**"我们从没测过这个"和"这个从来没通过"就分不开了**。
- **`revisit` 日期是必需的**，不是文档礼貌。没有它的排除会一路烂到某天有人以为它在被保护。
  建议默认 8 周；到期由覆盖测试提醒（断言所有 `shadow.revisit` 未过期，过期就红）——
  这样"重新看一眼"变成一个被闸门逼着的动作，而不是靠记性。

⚠️ **一个副作用要说白**：`sseinfo` 走影子之后，**上交所互动问答这一整个面就进入"没人监控"状态**——
它不是坏了不报，而是**它坏在只有国内出口才能发现的那个方向**。用户已明确接受（「默认这个能力有效，
等其他用户提 Issue」）。方案能做的是让这件事可追溯：Issue 正文固定列一行
「影子中（本视角不判）：`sseinfo_qa`（403 WAF，自 2026-10-08，复核 2026-12-01）」，
让"我们其实没在测它"每天早上都在报告里露一次脸。

---

## 4. 编排与限速（用户提的坑 2）

### 4.1 `hub.ts` 不是限速器，`throttle.ts` 才是

先破一个容易走错的方向：`hub.ts` 给的是**串行 + 去重 + 新鲜度复用**（全局并发 1，`hub.ts:475`；
队列上限 50，`:233`；30 s 超时，`:235`；in-flight 合并键 `capability:task_id:stableSerialize(params)`，
`:274-277`；manifest 复用短路，`:357-379`），里面**没有任何最小间隔，也没有 429 概念**。
本仓自己把这件事说透了（`src/net/eastmoney-client.ts:11-12`）：

> 「本仓 `DataCollectorHub` 的 FIFO 只保证"同一时刻只跑一个请求"，**不含最小间隔**——
> 串行 ≠ 节流，连打十个请求仍是一秒十次。」

巡检要用的是 `src/net/throttle.ts` 的 `createRequestThrottle`：Promise 链而不是 `await sleep()`——
`throttle.ts:4-9` 的理由对巡检同样成立（多个探针并发进入时各自 sleep 仍会同时发出）；间隔量的是
**上一个请求发出**的时刻（`:26-28`，`lastStartedAt` 在 `task()` 之前赋值）；链不因单次失败而断（`:31`）；
配错就响亮抛而不是静默变成「没限速」（`:18-21`，原文理由：「上游风控不会报"你太快了"——只会封 IP 或给空数据」）。

### 4.2 每家的节奏照抄生产，不重定义

| 上游 | 生产值 | 出处 | 巡检取什么 |
|---|---|---|---|
| 东财 | **1000 ms**，**进程级单例** | `eastmoney-client.ts:43`，口径理由 `:38-42`（社区实测风控：>5 次/秒、单 IP 并发 ≥10、1 分钟 ≥200、5 分钟 ≥300 → 临时封 IP） | `import { sharedEastmoneyThrottle }` 直接用 |
| 腾讯 | **120 ms**，五张工作面**一条链** | `tencent-public-core.ts:22`，`:17-21`（行情/分笔/K线换机/港美股/smartbox 都算同一家、按 IP 风控） | `import { tencentThrottle }` 直接用 |
| Fuyao | **生产无节流**，靠 Hub 串行 | `fuyao-core.ts:64-101` 是裸 `fetch` | ⚠️ 巡检必须自己加地板。`smoke-fuyao.mjs:138` 实测 400 ms 跑 61 端点；`data-collector-fuyao-expansion.md:291` 记 300 ms×17 未触发 4001。取 **400 ms**，注释写明「巡检专用，生产侧没有这个数」 |
| AnySearch / Wind / PaddleOCR | 无节流 | `retriever.ts:73`（「不缓存、不排队」）；Wind 只有退避重试 | 单次/个位数请求，串行 + 2 s 间隔即可 |

**为什么复用生产的单例而不是 `createRequestThrottle(1000)` 再建一个**——本仓为这件事写过复盘
（`eastmoney-client.ts:6-8`）：「两份独立节流 = 同一个出口 IP 上两个速率，等于没限」。
巡检进程里如果同时有 data 面和 retriever 面的东财代码，必须共用同一条链；跨进程则**根本不该并发**
（见 §4.3 的 `concurrency`）。

### 4.3 三条硬规矩

1. **按上游分组、组内串行、组间留 gap（建议 2 s）**，绝不跨家并发。
   东财 21 条一打就是 21 秒链上时间；把三家混在一起并发正中风控阈值。
   `cancel-in-progress: false` + `concurrency: group: data-source-contract`，防两次运行重叠在同一 IP 上叠速率。
2. **⛔ 巡检不加重试，一家都不加。** 生产侧刻意如此：`hub.ts` 零重试；只有 Wind 对**裸传输错误**
   退避 3 次（`wind-client.ts:291`，`[300, 1000]` ms），且 `WindTransportError`（任何 HTTP 状态）
   与超时都不重试（`:294-296`、`:258-261`→`:280`）。各家对 429 的一致态度是**「分类，而不是控制回路的输入」**——
   收到就打标并停止重试，没有任何一家动态调整速率。理由值得原样搬过来：
   **自适应会把「上游改了」和「我们的限速器变了」混成一件事**，而重试会把一次抖动变成两个都看起来很权威的数据点。
   想区分抖动，办法是**一天跑两次**（07:00 与 09:40）并只看「两次都坏」，不是加重试。
3. **`timeout-minutes` 要算出来，不能拍脑袋。** 无重试意味着一条挂住的探针吃掉自己整份预算。
   daily 档 ~60 条、单条上限 20 s → 最坏 20 分钟；weekly 全量 100 条 → 最坏 33 分钟。
   建议 daily 12 / weekly 30，并在**跑不完时把「未跑完」本身报成一个结论**（不是静默截断——
   静默截断等于「今天全绿」，那是这套系统最坏的失效模式）。

   还有一个必须写进文档的放大器：`sseinfo` 单公司分支一次 code→uid 解析要**串行 10–13 个请求**
   （`sources.ts:480-486`，`SSE_UID_LOCATE_TIMEOUT_MS = 60_000` 的注释就是为这件事写的）。
   这条放 weekly，且预算单列。

---

## 5. 调度与 runner

### 5.1 cron 与两个日历陷阱

```yaml
on:
  schedule:
    - cron: '0 23 * * 0-4'   # UTC 日1–四23:00 = 北京 周二–周五 07:00 → tier=daily
    - cron: '0 23 * * 5'     # UTC 周五 23:00 = 北京 周六 07:00 → tier=full（周六全量）
  workflow_dispatch:
    inputs:
      tier: { description: 'daily | full', type: choice, options: [daily, full], default: full }
```

四条会静默咬人的 GitHub 语义，逐条记下：

- **GitHub cron 只认 UTC，而且星期字段也是 UTC。** 北京 07:00 = **前一天** 23:00 UTC，
  所以「周一到周五」在 cron 里写作 `0-4`（周日到周四）——**日期与星期都退一天**。
  写成 `0 7 * * 1-5` 会得到北京时间 15:00 且**盘后**，那时当天所有数据都已落地，
  正好错过「开盘前告诉我昨天坏在哪」这个唯一的价值窗口。这种错不会报错，只会让整套东西失去意义。
- **tier 由 workflow 自己判，不能靠 cron 传参**（`schedule` 事件不带 `inputs`）。
  两条 cron 分开写只是为了让意图可读；真正决定跑哪一档的是脚本里那句
  「北京时区的今天是不是周六」。**这句必须用 `Asia/Shanghai` 显式换算**，
  直接读 runner 本地时间会拿到 UTC，于是周六判定错位一天、全量档静默永不触发。
  （这与 §1.3 的日期归一只有一份实现是同一条纪律：时区换算不给第二条路径。）
- **定时触发不准点。** 高峰延迟常见几分钟、极端可到一小时以上。07:00 距 A 股 09:30 有 2.5 小时余量，
  这就是为什么这个点位合理；但别把任何逻辑建立在「刚好 7 点」。
- **schedule 只在默认分支上生效**，且**仓库 60 天无 commit/push 时 GitHub 会静默停用定时任务**。
  本仓当前活跃度不至于踩这条，但它是一条「什么都不报错、就是不跑了」的失效，所以 §5.3 看门狗不是可选项。
- **`schedule` 事件能读到 repo secrets**（fork 的 `pull_request` 不能，而我们不做 PR 触发）。


### 5.2 单一 runner：`ubuntu-latest`，并在报告里钉死视角

已定：**不做 self-hosted，不做双视角矩阵**（没有这类机器；改接 Gitee 的复杂度不成比例）。
所以 §1.2 那套四象限判断只剩两格能用，方案这边跟着收缩成三件具体的事：

```yaml
jobs:
  probe:
    runs-on: ubuntu-latest          # 唯一 runner
    timeout-minutes: 12             # daily；weekly 30（§4.3 第 3 条）
```

1. **每次运行先把出口身份打印出来并写进 Issue**（`ipinfo.io/json` + ASN）。这不是装饰：
   hosted 的出口 IP 是**会换的**（同一机房不同机器），一旦某天噪声突然变多，
   `20.83.175.155` 还是不是昨天那个 IP，是唯一能事后对得上的线索。
2. **Issue 标题固定带「海外视角」四个字**，正文固定带 §3.2 那句「本结论仅代表 `<IP/ASN>` 视角」。
   诚实的残缺视角 > 假装完整。
3. **`TRANSPORT` 一律降级成信息**（§2.3）——共享机房 IP 的网络抖动不代表上游坏了，
   这一条是单视角能活下来的前提，不是妥协。

⛔ 顺带记一条实现约束：hosted 侧**不要**沿用 `engines.ts:83-85` 的 AnySearch 回退路径。
`shouldFallbackToLocalFetch` 只排除 `ABORTED` / `INVALID_URL` / `UNSUPPORTED_CONTENT`，
**`RATE_LIMIT` 不在其中**——线上一遇 429 就静默改成从本机 IP 直连目标站。
巡检借那条路会把「一次 429」变成「双份出网，且打到一家从没跟我们打过交道的第三方站点」。
巡检必须直连 `api.anysearch.com` 判信封（§7.3 坑 4）。

### 5.3 看门狗：单独一个 workflow，不是同一个 job

「探针没跑」和「探针全绿」在 Actions 列表里长得一样——都没有新记录。这是本仓 §9.7 那一族的
运维版：**注册面押在「装配期读一次的外部状态」上，失败即静默不注册且整场不重试**
（`AGENTS.md` §9.7 第 ⑤ 条，2026-09-30 同花顺 61 颗能力静默消失那次）。同一个教训换个载体又回来了。

**必须是另一个 workflow**，理由只有一条：调度被 GitHub 静默停用（60 天无活动）时，
写在同一个文件里的自查步骤也跟着不跑——**两个独立调度器，其中一个才发现另一个死了**。

```yaml
# .github/workflows/data-source-contract-watchdog.yml
on:
  schedule: [{ cron: '30 1 * * *' }]     # UTC 01:30 = 北京 09:30，给 07:00 那次留出延迟余量
permissions: { contents: read, issues: read, actions: read }
# 查 GET /repos/…/actions/workflows/data-source-contract.yml/runs 里 26 小时内有没有 completed 记录；
# 没有 → 开一张「数据源巡检未运行」Issue（复用同一个 label，正文只讲这件事）。
```

两条要注意的：

- **看门狗自己也会静默停摆**（同一个 60 天规则）。它监控别人，没人监控它——这已经是能做到的
  最深一层，剩下的风险由「看门狗那张 Issue 长期不再出现」这个反常信号兜：巡检正常时它什么也不发，
  连日不发就等于它自己没跑。**因此看门狗每次跑都要在 workflow summary 留一行"我活着"**，
  这样它的不发声是可见的，不是推断的。
- **别把看门狗做成"检查 Issue 有没有发出来"**。巡检全绿本来就不发 Issue，那条判据会把正常状态判成故障。
  要查的是**运行记录**，与结论无关。

### 5.4 国内出口留成仪器，不留成监控

用户已放弃国内视角的**监控**，但没必要放弃这个能力。做法：探针脚本本身与 runner 无关，
所以 `npm run contract:probe` 在任一台国内机器上直接可跑（走同一套注册表、同一套 `validateOutput`、
同一个影子名单），只是**不进 CI、不发 Issue**。价值在于：当有用户报「东财板块取不到数」时，
先跑一次它，两分钟就能把「上游真挂了」和「hosted 视角看不见的那类故障」分开——
这正是单视角唯一补不回来的那一格。写进 `docs/dev/` 的排查一句话，成本是零。


---

## 6. 凭据落点（用户问的坑 1：「GitHub 哪里可以填 .env」）

### 6.1 位置与现状

**没有「仓库里放 .env、对外不可见、CI 里可用」这种机制。** `.env` 一旦提交就在 git 历史里，
`.gitignore` 只挡误提交、挡不住已经推上去的。GitHub 对应的东西叫 **secrets**：

> 仓库页 → **Settings** → 左侧 **Security** 分组 → **Secrets and variables** → **Actions**
> → **New repository secret**（ name = `FUYAO_API_KEY`，value = key 本体）

本仓当前状态我查过：**仓库 secrets 0 个、variables 0 个、environments 0 个**
（`gh api repos/v587d/capital-generation/actions/secrets|/variables|/environments` 全空）。
所以要手工补。这一步只能你做（我没有、也不该有写入你凭据的权限）。

需要填的名字（**沿用代码里已有的 ref 名，不另起一套**，见 `src/index.ts:410-438`、
`capital-config/client.js:8`）：

| Secret | 用途 | 缺失/过期时会怎样（⚠️ 全部走 §6.4 的红，不当成巡检结论） |
|---|---|---|
| `FUYAO_API_KEY` | Fuyao 61 能力，header `X-api-key` | `fuyaoRequest` 本地就抛 `credential_missing`，**请求根本不发**（`fuyao-core.ts:71-78`） |
| `ANYSEARCH_API_KEY` | AnySearch 2 端点，`Bearer` | ⚠️ **不带 key 请求照样成功**（实测两个视角都 200 + 真结果，`engines.ts:192-199` 是 `if (apiKey) headers.authorization = …`）→ **四家里唯一"缺 key 会假绿"的**，必须靠 §6.4 前置闸门挡住 |
| `WIND_API_KEY` | 只做不计费的 `initialize` / `tools/list` | 401（实测）；Key 过期与域名消失两种故障在 401 上分不开，报错要带上响应 `code` |
| `PADDLE_OCR_TOKEN` | OCR 端到端（weekly 档） | 本地抛 `NO_CREDENTIAL`，不发请求（`ocr/client.ts:151-157`） |

Fuyao / Wind / Paddle **缺 key 根本不发请求**（本地抛），AnySearch **缺 key 照发且能成**——
所以不能把四家当同一种「要 key 的源」写判断逻辑，这也是 §6.4 那道闸门必须在**发任何请求之前**的理由。

Secrets vs Environment 的取舍：Environment（Settings → Environments）能加「只允许某些分支用」和
人工审批，代价是 job 必须显式声明 `environment:`。对一个只在默认分支跑的定时任务，
**repository secret 就够，不必建 environment**——少一层配置就少一处「配了但没生效」的排查面。

注入方式：`env: FUYAO_API_KEY: ${{ secrets.FUYAO_API_KEY }}`，脚本侧**一行都不用改**——
`scripts/lib/credentials.mjs:14-24` 的 `resolveCredential()` 已经是「env 优先，其次
`~/.dsh/.credentials.yaml`」。同一条解析路径同时服务本机手跑和 CI，这正是它存在的理由
（它自己的注释：两处各写一遍正则就是 §9.7 那一族）。**不要**在 CI 里生成 `.env` 文件。

⚠️ 但这条解析路径**不等于 GitHub 会把 secrets 自动注进 env**：四家要逐条显式写。少写一条的对称症状
是"CI 天天红、本地怎么跑都好"（`assertCredentials()` 在发请求之前就停），而本地恰恰是最好的出口——
所以 `test/contract-registry.test.mjs` 直接读 workflow 正文，按 `FAMILY_SECRET` 逐条核对映射；
新增一家凭据时，注册表会替你把 workflow 一起要。同一份测试还钉 cron 的 UTC 偏移（写 `7` 而非 `23`
会让北京周六那档全量永远打不到，且日档照常绿，没人会发现少了周六）。

### 6.2 ⛔ 泄露面：mask 挡不住的不是秘密本身，是被写进日志的 URL

Actions 会把 secret 值本身打码，但三种常见写法能绕过它，而且都是本仓已经付过学费的方向：

1. `set -x` / `shell: bash -x` 把 `curl -H "X-api-key: $KEY"` 整行打出来。
2. **错误消息里带完整 URL**。Fuyao 的 key 在 header、不在 query（`fuyao-core.ts:75-78`），AnySearch/Wind
   也是 header——这两家安全。但 `paddleocr` 的结果是**预签名 URL**，且
   `src/ocr/client.ts:241-249` 明确记着「预签名结果 URL 必须**不带** bearer 去取，
   带上会得到 400 `MissingDateHeader`，且把 token 送到第三方存储域就是凭据外泄」。
   → 巡检如果打 OCR，**只打 host + path，永远不打 query**。
3. **Issue 是公开的**（本仓 public）。所以 redaction 规则必须同时约束 Issue 正文，不只约束日志。

因此定一条巡检自身的输出纪律，与 `smoke-fuyao.mjs:11-13` 已有的那句一模一样：

> ⛔ 不打印密钥、**不落盘任何响应数据**。Issue 里只允许出现：host、path、上游 code 原值、
> 键名清单（key names，不含 value）、行数、耗时。响应正文一个字节都不许进 Issue。

### 6.3 一个实测副产品：Fuyao 无 key 给的是 `2003`，不是 `2001`

`docs/reference/fuyao/llm_full.md:424-441` 的口径是 `2001` = 未认证（缺 key / key 无效）、
`2003` = 该 key 不含此能力。实测**两个视角下缺 key 都是 HTTP 200 + `code=2003`**。
两件事由此而来：

- 好消息：Fuyao 可以**零配额**做「路由存活」检查（不需要 key，也不会消耗任何配额）。
- 需要注意：`fuyao-core.ts:84-99` 现在把 `2003` 落到 generic `upstream_error`。产品永远带 key，
  所以这不是 bug；但如果巡检想用「无 key 探针」当低成本心跳，就得按实测的 2003 来判，
  而不是按文档的 2001。**这条正好是 §10.2「护栏拒绝官方示例就是真实取数事故」的反向版本**：
  按文档写的码去判真报文，会判错。

### 6.4 开工前闸门：缺 key 就红，一个请求都不发（已定）

注册表每条带 `secret`（§3），闸门是巡检的**第一个 step**，在发任何网络请求之前：

```text
收集本次 tier（daily | weekly）全部条目用到的 secret 名 → 逐个 resolveCredential()
任一为空 → ::error:: 点名是哪个、要去仓库 Settings 的哪一格填 → exit 1，不发任何请求
```

三条理由：

- **信道上**：红 = 我们的工具有问题；Issue = 上游有问题。混在一起，「Key 过期」就会被读成
  「东财挂了」，而两者的修复方向完全不同。这条分工同时是 §5.3 看门狗与 `npm test` 覆盖闸门
  能共用「红 = 我方故障」这一个语义的前提。
- **正确性上**：AnySearch 是唯一缺 key 也照样返回 200 + 真结果的一家（§6.1）。让它跑起来就是假绿，
  而假绿比红危险得多。
- **成本上**：先检查再发请求，避免「跑了 25 次 Fuyao 之后才发现 Wind key 没配」——
  那种半成品报告既烧配额又没法解读。

⚠️ 一条别顺手做宽的边界：闸门**只管本次 tier 真用到的 secret**。weekly 才需要的
`PADDLE_OCR_TOKEN` 不该让 daily 跑失败；否则一次日常巡检会被一个今天根本没测的东西挡住。

---

## 7. Issue 形态（用户选：每天一张汇总 Issue）

### 7.1 规则

- **只有结构/状态级失败才创建**（已定）：`GUARD`、`ENVELOPE`（白名单除外）、`HTTP_STATUS`。
  `TRANSPORT` / `SLOW` / `EMPTY` / `EXCLUDED_SHADOW` **一律只进 workflow summary 与 artifact JSON，不开单**。
  这条阈值是这套东西能不能活过第三周的唯一决定变量——判据与理由见 §2.3。
- **全绿那天**不发 Issue，把结论写进 workflow summary，并**关闭仍未恢复的旧单**（否则单会越攒越多，
  而「持续第 N 天」的推算依赖未关闭的旧单）。
- 标题：`数据源契约巡检 2026-10-08：<N> 项不合格（最高 GUARD）· 海外视角`
- label：`data-source-contract`（**仓库现在只有 GitHub 默认 label，这条要一次性手工建**：
  `gh label create data-source-contract --color D93F0B --description "每日 HTTP 契约巡检失败"`。
  手工建好 = workflow 只需要 `issues: write`，不必再要 `labels: write`）。
- **同一天不重复开**（`schedule` + 手动 `dispatch` + 失败重跑都可能撞同一天）：
  先 `gh issue list --label data-source-contract --state open --search "2026-10-08 in:body"`，
  命中就 `gh issue edit --body-file`（覆盖）而不是新建。这才对得上「每天一张」这句话。
- **连续第 N 天**：对每个今天失败的 capability，数一下未关闭的同 label Issue 里有几张提到它，
  在表格里写「持续第 N 天」。零额外存储。
- **恢复**：过去有未关闭单、今天通过 → 正文单列一节「已恢复」，并在今天这张里注明原单号。

### 7.2 正文结构（面向「拿到就能修」）

```
## 巡检结论
run-date 2026-10-08 · tier daily · 视角 20.83.175.155（Azure US Dulles, AS8075）——本结论仅代表此视角
A股交易日: 是（fuyao trading_calendar）· node 24 · commit 705cf10 · 计时 3m41s

## 不合格（2）
| 判据 | 能力 | 上游 | HTTP / 上游 code | 耗时 vs 预算 | 持续 |
| GUARD | eastmoney_holder_number_snapshot | datacenter | 200 / code=0 | 743ms/20s | 第 1 天 |
| ENVELOPE(2001) | fund_profile | fuyao | 200 / code=2001 | 340ms/20s | 第 1 天 |

## 核心字段证据   ← 这一节是「准确报错」的正解
eastmoney_holder_number_snapshot
  期望信封: { item: array, pagination: object }   （validateOutput, eastmoney-http.ts:1135）
  期望首行键: [security_code, security_name, holder_num, ...]（17 个，取自 output.schema）
  实得首行键: [SECURITY_CODE, SECURITY_NAME, HOLDER_NUM_TOTAL, ...]
  差异: 键名回到上游原样 —— §10.6 的 ASCII snake_case 映射表这次没生效
  → 修复方向: 映射表，不是重试；行数 20/20，说明只是键名口径变了

## 本视角不判（影子中，2）
sseinfo_qa            403 WAF，自 2026-10-08，复核 2026-12-01 —— 本能力当前无人监控
wscn_lives            429，自 2026-10-11，复核 2026-12-01

## 已知红（白名单，不报，3）
fund_manager_style / fund_manager_performance / fund_indicator_table  code=5003 数据缺口（§10.4）

## 抖动（不进结论，只留痕，4）
tencent_kline  TRANSPORT UND_ERR_SOCKET ×1/1  ·  push2 clist 同
```

三点值得单看：

- **「不合格」表里 `HTTP_STATUS` 与 `ENVELOPE` 必须带上 `200` 这种 HTTP 码**。Fuyao 的 HTTP 状态永远是
  200、业务错误全走信封 `code`（`docs/reference/fuyao/llm_full.md:455`）。只报 HTTP 码 = 什么都没报。
- **影子清单每天早上露一次脸**（§3.2）。这一节不是格式，是「我们其实没在测这些」的可追溯记录。
- **「抖动」单独一节但不进结论**。`push2 clist` 这类如果连续很多天都抖，那本身是信息；
  把它写出来而不发警报，正好是用户要的「正常按 GitHub 巡检，巡检没问题就当正常」的实现口径。

### 7.3 四条已经埋好的坑，方案里必须显式处理

1. **`analytics_data` 会每天固定红。** `wind-client.ts:21-22` 记着它「实测连 `initialize` 都挂满 60 秒」，
   本仓刻意没接。注册表要把它显式标成 `excluded`，注释带上这条实测——否则第一次跑就有一条无人能解释的红，
   然后大家开始忽略这个 Issue。**一个会喊的假警报，代价是之后所有真警报。**
2. **`5003` / `2004` 不算失败。** §10.4：`2004` 是同花顺客户端专用（不重试、不注册）、`5003` 是数据缺口
   （「不要反复重试」）。已记录的 2026-09 全量冒烟里本来就有 3 条 `5003`
   （`fund_manager_style` / `fund_manager_performance` / `fund_indicator_table`）。
   这三条进注册表白名单当**已知红**，每天在正文列一次，但不算不合格、不新开 Issue。
   ⚠️ 白名单条目同样**必须带 `since` + `reason`**（§3.2 同一条理由）：白名单是最容易一路烂成
   「所有红的都在白名单里」的地方。
3. **AnySearch 缺 key 会假绿。** 已由 §6.4 的开工前闸门挡住。这里再记一次机制，因为它不直观：
   `engines.ts:192-199` 是 `if (apiKey) headers.authorization = …`——没 key 就干脆不发这个头，
   请求照旧出门，而且**照样返回 200 + 真结果**。Fuyao / Wind / Paddle 三家缺 key 是本地就抛、
   根本不发请求，只有这一家会静默通过。
4. **巡检不能借用 AnySearch 的回退路径。** `shouldFallbackToLocalFetch`（`engines.ts:83-85`）排除的三类是
   `ABORTED` / `INVALID_URL` / `UNSUPPORTED_CONTENT`，**`RATE_LIMIT` 不在其中**——线上 AnySearch 被限流会
   静默改成从本机 IP 直连目标站。CI 里这条会把「一次 429」变成「双份出网，且打到一家从没跟我们打过交道的
   第三方站点」。巡检要**直连 `api.anysearch.com` 判信封**，不走这个产品路径（§5.2）。


---

## 8. 覆盖广度（用户选：分层，周六全量）

按你的口径落成注册表里两个 tier。**具体名单是提议，可改；机制不是。**

### 8.1 `daily`（每档 73 条，实测 hosted 跑完约 2.5 分钟）

| 家族 | 覆盖 | 条数 | 为什么全量 |
|---|---|---|---|
| 腾讯 | 全部 9 能力 + smartbox | 10 | 你点名的「抓取相关、不稳定」；免费；120 ms 链最松；港美股快照/K线/指数是较新的面 |
| 东财 data 面 | 全部 21 能力 | 21 | 同上；1 000 ms 链下 21 条约 21 s，可接受。**9 张宏观表尤其要天天打**：它们最容易被上游改列而**静默**改单位（`§10.6` 一族） |
| web_retriever 具名来源 | 9 条，其中 `sseinfo_qa` 走**影子模式**（§3.2） | 9 | 这 9 条**只有 fixture、没有 live 脚本**（现状盘点见 §9），HTML 解析面是最脆的。`sseinfo` 海外稳定 403 → 照跑不报，正文每天露一次脸 |
| Fuyao 股票常用 | `ticker_search` `ticker_list` `quote` `history` `valuation` `auction` `auction_benchmark` `corporate_actions` `trading_calendar` `index_quote` `index_history` `index_constituents` `index_catalog` `limit_up/down/break_pool` `limit_up_ladder` `skyrocket_list` `hot_stock_list` `anomaly_list` `anomaly_stock` `dragon_tiger` + 三大报表 + `financial_indicators` | ~25 | 你说「基金那些低频的挪周六」；配额按你的判断是量化口径，低频打不到 |
| AnySearch | `/v1/search` `/v1/extract`（带 key，闸门见 §6.4） | 2 | |
| Wind | 6 个 server 的 `initialize` + `tools/list`（**不计费**，`wind-market-source.md:211`） | ~12 | 你选的方案。抓域名下线 / TLS / Key 失效 / MCP 工具改名，四类都不花钱。`analytics_data` 走 `excluded`（§7.3 坑 1） |
| — | `trading_calendar` 放在**最前面**跑 | (含上) | 它的结果决定后面所有 `EMPTY` 怎么解释 |

### 8.2 `weekly`（周六那一档共 109 条 = daily 73 ＋ 36）

daily 的全部 **＋** Fuyao 剩余 ~36 条基金类（profile / nav / holdings / holders / manager 系 / backtest /
indicators / quota / dividends）、`sseinfo` **单公司分支**（10–13 请求放大，`SSE_UID_LOCATE_TIMEOUT_MS`
单独预算——注意这条也在海外 403 的那一挡里，同样是影子）、PaddleOCR 端到端一次
（真上传一份小 PDF，`src/ocr/client.ts:4` 实测 15 页 31 s）。

### 8.3 一次请求都不是白花的理由

daily 里我坚持**每能力一条、不做「每族一个代表」**，因为它恰好丢掉最重要的信号：
上游改版通常**打中一个端点，不打中一族**。用代表端点，你会在周一早上以为全绿，
而周五坏的那条一直在悄悄返回错数据。腾讯 + 东财全量本身是免费的公开端点，唯一的真实成本是
Fuyao 的 ~25 次/天——用户已确认接受（Fuyao 限流口径是 QPS/负载，不是累计配额，
`docs/reference/fuyao/llm_full.md:9`）。


---

## 9. 这套东西替换/收纳了什么（现状盘点）

「要不要为巡检新写一套端点定义」——不用，也不该。已有的仪器：

| 已有 | 覆盖 | 缺口 | 处置 |
|---|---|---|---|
| `scripts/smoke-fuyao.mjs`（`npm run smoke:fuyao`） | Fuyao **全部 61 能力**，参数表 `:28-90`，400 ms 间隔，`validateOutput` 判定，缺参数表即 exit 2 点名 | 手工跑，不进 CI；单家 | **抽成通用 runner**，参数表原样搬进注册表（不重写） |
| `scripts/smoke-wind.mjs` | Wind 数据面 3 能力（**计费**） | 只有 economic/stock，`financial_docs` 无 live 脚本 | 保持手工；不进日常 |
| `scripts/spike-wind.mjs --auth / --list` | 7 server 的 initialize 与 tools/list，**不计费** | 无 npm alias、输出非结论 | 直接成为日常 Wind 探针，输出改成 §2.3 的判据 |
| `scripts/smoke-local-fetch.mjs` | SSRF 闸门 + 7 个固定 URL，**刻意总是 exit 0** | 不覆盖 AnySearch 主路 | 保持原样，不动它的语义（那是报告器不是闸门） |
| 腾讯 9 / 东财 21 / 具名来源 9 | **只有 fixture，没有 live 脚本** | 这是最大的净缺口 | 巡检的主要增量就在这里 |

所以这个方案的净新增是：**多数据源通用 runner + 注册表（含 tier / 影子 / 白名单三态）+ 开工前凭据闸门
+ Issue 发布 + 看门狗 + `npm test` 覆盖完整性断言**。
判据、参数、限速、信封语义全部复用已有的。


---

## 10. 明确不做（带理由）

1. **不做 Wind 取数级契约。** 积分。只保留 `initialize` + `tools/list`（实测 401/200 语义清楚，不计费）。
2. **不把契约外置成 `schema.json` / `manifest.json` 让上游"来对"。** 上游不会给你契约；
   本仓的契约是 `output.schema` + `validateOutput`，已经两道强制。再写一份 = 第二份真相 = §9.7 那一族。
3. **不引入 digest / 裁剪阶梯 / 结果缓存层。** `docs/dev/data-roles.md` §1.1 已经收敛过「体积闸门只有一道」，
   巡检不是数据面，不该把那个决策重新打开。
4. **不给任意 URL 面（`web_retriever_fetch`、`ocr url=`）做每日可达性测试。** 这个面**是开口的**，无法枚举；
   能测的只有闸门本身，而那已经有 `smoke-local-fetch.mjs`。
5. **不做看板 / 时序库 / Grafana / 后端存储。** 跨天趋势从 Issue 历史读，明细留 workflow artifact JSON。
   加一套存储就多一处「存储挂了于是没人知道上游挂了」。
6. **不在巡检里加重试或自适应限速。** 理由见 §4.3 第 2 条（生产侧 429 是分类不是控制输入；
   自适应会把两件事混成一件）。要区分抖动就一天跑两次看交集。
7. **不把巡检并进 `npm test`。** `npm test` 每次 push 都跑，`test.yml` 还是 ubuntu+windows 双端矩阵
   （`:24-26`）——那等于每次 push 打一遍真网络：不可重放、白烧配额、并把外部故障混进我们的红
   （`test.yml:52-55` 已经为同一件事写过分寸：Windows 侧不装 dsh 就报 skipped 而不是 pass）。
   分工：**`npm test` 钉注册表完整性与静态形状（离线可跑）；网络巡检只在 schedule / dispatch 跑。**
8. **不引入浏览器 / playwright 抓取。** 实测 403 只出现在 `sseinfo` 的海外视角，那是 WAF 不是 JS 挑战；
   腾讯系与东财系公开端点是 HTTP + 本地签名（`clsSign`，`sources.ts:201-210`）。
   需要浏览器的那天，是这套判据该重新讨论的那天。
9. **不做「自动修复」或自动改映射表。** 巡检只报形状差异，人决定改不改。
   §10.6 的键名映射表是显式判断，机器不该在这里替你做判读。
10. **不做可达性 SLO，也不做「国内用户今天能不能取到数」的承诺。** 单视角 hosted 巡检的定位是
    **契约/结构看门狗**（§1.2）。把它当成可用性监控会得出错误结论——而且是每天看起来都很正常的那种。
    国内出口的能力留在 `npm run contract:probe` 这件仪器里（§5.4），出事手动跑，不进 CI。
11. **不接 Gitee / 国内 CI 来补国内视角。** 用户已判定复杂度不成比例，这条写下来是为了防止将来
    有人把「巡检看不见国内故障」当成引入第二套 CI 的理由——那套东西的运维成本高于它买到的信号。

---

## 11. 剩下的待办与待确认

### 11.1 已定（本文其余部分都按这五条写）

单 runner（hosted，报告里钉死视角）· 影子模式承接不可测能力 · 只有结构/状态级失败开 Issue ·
独立 watchdog workflow · 缺 key 前置闸门直接红。另外 `push2 clist` 按用户的判断（当时的出口是
星巴克公共网络，IP 信誉问题）归入 `TRANSPORT`，不进 Issue；hosted 巡检通过就算正常。

### 11.2 只有你能做的两件事

1. **填 secrets**：仓库 Settings → Secrets and variables → Actions 里补
   `FUYAO_API_KEY` / `ANYSEARCH_API_KEY` / `WIND_API_KEY` / `PADDLE_OCR_TOKEN`（我没有、也不该有这个权限）。
   没填之前巡检的第一个 step 就会红，这是设计好的行为，不是故障。
2. **建 label**：`data-source-contract`。这条我有 token，**你点头我就用 `gh label create` 建**；
   建好之后 workflow 只需要 `issues: write`，不必再要 `labels: write`。

### 11.3 实现顺序（依赖关系，不是任务清单）

1. 先写 `scripts/lib/contract-registry.mjs` + 覆盖完整性测试，并把它接进 `npm test`
   ——**先有闸门再有 runner**：注册表一旦能被测试钉住，后面每次加端点都不会漏巡检。
2. 把 `smoke-fuyao.mjs` 抽成多数据源通用 runner（Fuyao 参数表原样搬进注册表，不重写）。
3. 凭据前置闸门（§6.4）→ Issue 发布步骤（§7）→ watchdog（§5.3）。
4. **第一次真跑用手动 `workflow_dispatch` 全量**，拿它的实测 P95 回填 `budgetMs`（§2.4），
   并确认哪些条目实际该进影子/白名单。别拿今天两个视角的样本写死常数。
5. 最后才挂 `schedule`。

### 11.4 四处我还没证据、需要你或实测补的

- **响应时间预算**：目前只有 16 个国内点 + 一轮 hosted 点，`SLOW` 阈值只能先偏大地给 20 s，等第一次
  hosted 全量的 P95 回填。
- **`sseinfo` 之外的源有没有同类"海外专属 403"**：hosted 那一轮我只在 `sseinfo` 上看到 403。
  第一次全量跑（尤其 21 条东财 + 9 条具名来源）大概率还会捞出几条，届时按 §3.2 逐条登记。
- **`5003` 白名单是否仍然成立**：记录来自 2026-09（`data-collector-fuyao-expansion.md:513` 自己
  标注过「此前的表述证据不足」）。第一次全量跑会重新验一遍，别照抄旧结论。
- **Wind 握手有两份 `protocolVersion` 字面量**：探针侧 `scripts/lib/wind-rpc.mjs:15` 与生产侧
  `src/web-retriever/wind-client.ts:315` 都写着 `'2025-03-26'`，今天核对过是一致的，但**没有任何测试
  守着**。生产哪天抬协议版本，探针就会继续用一个线上再也不发的握手去判"上游没问题"——正是 §9.7
  那一族（同一能力两个入口、只有一个被测到）。探针侧独立成一份是刻意的（生产客户端自己坏了不该
  让上游背锅），所以修法不是合并成一份，而是加一条"两处字面量必须同值"的断言。

### 11.5 落地时被实测改写的几处（写下来，因为从代码里读不出来）

1. **§4.2「复用生产节流单例」照做会自锁。** 把 `tencentThrottle` / `sharedEastmoneyThrottle()`
   套在 `source.execute()` 外面，而 `execute()` 内部**已经**在同一条约链上排队——外层占着链等内层，
   内层排在同一条链后面等外层让位。症状是**第一条探针永久挂住**，不报错、不超时（2026-10-08 实测踩到）。
   正解：巡检对东财 / 腾讯 / 具名来源**不加任何一层**（`NO_PACE`），它们的节奏由生产代码负责；
   只有生产侧本来就没有节流的 Fuyao 才由巡检自己加 400 ms 地板。
   「复用同一份实现」不等于「再包一层」——同一个单例被套两次就是死锁，不是复用。
2. **§2.4 的延迟预算不能同时当超时用。** Wind 协议探针起初把 `budgetMs` 直接当 abort 用，
   结果 6 台 server 里 3 台报 `TRANSPORT`；把 abort 放宽到与生产 `WIND_REQUEST_TIMEOUT_MS` 同值 60 s 后，
   六台全部 226–494 ms 通过。**"慢"和"坏"是两个判据，需要两个数**，混成一个就会把慢服务天天误报成挂了。
3. **`push2 clist` 的抖动被证实了。** 同一台机器、间隔几分钟：一次 5/5 RST，下一次 `sector_rotation`
   与 `cashflow_rotation` 双双 PASS，再下一次又 RST。这正是 §7.1 把 `TRANSPORT` 挡在 Issue 之外的理由——
   如果它算失败，这套东西第一周就会开出三条谁也修不了的单子。
4. **`github-api.mjs` 里写了 TypeScript 的参数属性，只有 CI 会发现。** 第一次 hosted 全量的形状是：
   巡检 109 条跑完、明细上传成功、然后"发布 Issue"在 import 阶段 `SyntaxError`。本地 858 条测试一条都
   没拦住，因为**没有任何一条 import 过它**。修法之外还补了 `test/contract-scripts-parse.test.mjs`
   （对 `scripts/` 逐份 `node --check` + 逐份 import `scripts/lib/`）——但要说清它的边界：`--check`
   只保证**能加载**，不保证行为，脚本逻辑仍然只有真跑才算验过。
5. **"连续第 N 天"会把当天自己算成前一天。** 原实现从"同 label 的未关闭单"里数，而 schedule + 手动
   dispatch + 失败重跑会撞在同一天：第二次跑时今天那张单已经在列表里，正文就念成"第 2 天"。这条只能
   靠真发一次单发现——**同一天第二次发单必须走"改正文"而不是新建，且天数不许因为看到自己而 +1**。
   已按 `history = opens - todayIssue` 修正，并用 run #1 的真实报告对线上验过两次（单张数仍是 1、
   正文里没有"持续天数"段）。
6. **工作日改到北京 06:00（2026-10-10 拍板），顺带查出两处"日期说错话"。**
   动手才发现排程真值散在两个载体里：YAML 的 cron 是给 GitHub 读的，看门狗还要一份能算"最近本该跑
   的时刻"的。原先那条"小时字段必须是 23"的断言恰恰是靠不住的写法——它把一次改时间变成两处必须
   手工同步的暗雷。现在把 `SCHEDULE_UTC` 提进注册表（每条自带小时），回归逐个 **(星期, 小时)** 比对，
   工作日 06:00 与周六 07:00 能各判各的。
   更值钱的是另一处：Issue 标题与正文的 `run-date` 原本是 `report.at.slice(0, 10)`，那是 **UTC 日**。
   北京 06:00 = UTC 前一天 22:00，照那个切法**每一天的单都会盖着昨天的日期**，同天去重也会跟着错；
   2026-10-09 那次定时跑恰好迟到 4 小时、落进 UTC 10-09，反而把问题遮住了。现在统一走 `beijingDateOf()`。
   调度延迟实测两个数：原定 UTC 23:00 那档 **02:48 才跑**（迟 3h48m），看门狗原定 01:30 那档
   **07:36 才跑**（迟 6h11m）。所以心跳的定义只能是"晚于应跑时刻跑过没有"，问准点没有意义——
   把 07:00 提前到 06:00 也不改变这一点，只是给 A 股 09:30 多留一小时。
7. **复查自动化（2026-10-11）：先证伪"周末没跑"，再把两处押运气的地方改掉。**
   账是清楚的：workflow 激活（10-08 15:21 北京）到复查时 `schedule` 只欠两档、也只跑出两档——
   #3 = 北京周五 daily 73 条，#4 = 北京周六 **full 109 条**（36 颗 weekly 首次真打，全 PASS）；
   北京周日按设计不排，看门狗周日回看的是周六那一档、判正常。没发单是因为 `failing=[]`，
   两次日志末尾都写着"本次全部通过，不开单"。**用户看不见的不是没跑，是跑了但没结论。**
   迟到的真数补齐：#3 迟 3h48m、#4 迟 3h13m，而同仓 `push` 触发的 test.yml 与 push **同一秒**建 run
   （11:31:54 → created 03:31:55Z）——迟到是 `schedule` 通道独有的，不是 runner 排队。于是再往前挪到
   **北京 04:00**：工作日与周六落进同一个 UTC 小时（20:00），两条 cron 并成一条 `0 20 * * 0-5`，
   `SCHEDULE_UTC` 跟着并成一条，档位仍由 `resolveTier()` 按北京星期分。
   真正修掉的是看门狗的判据。它原来问"最近**该跑**那一档之后有没有 schedule 记录"：旧 07:00 档下
   探针落地时刻**晚于**看门狗的名义 09:30，那两天都会被判成"没跑"，没报警纯属看门狗自己更晚（6 h）；
   并到 04:00 之后名义余量 5.5 h，仍然是在赌两条 best-effort 调度谁迟得少。现在判**上一档**
   （`previousScheduledDue` = 把时刻推一天再取 `lastScheduledDue`），被检查的那一档至少已经过去
   24 h——探针要迟满一整天才算没跑，代价是发现调度器死了要晚一天。规则抽进 `heartbeatVerdict()`
   之后它才第一次有了离线测试：**此前看门狗的 workflow 与脚本零覆盖，而探针侧有 16 条**。
   另一半是收尾：健康分支原来只打一行日志，而 `closeDecision()` 明确拒绝关这张单（告警正文一个能力名
   都不提，这是特意加的）——**两边都以为对方负责，一张假告警就永远挂着**，而"永远挂着的第一张"会把
   之后所有真告警稀释成噪声。现在健康时按 `isWatchdogAlarm()` 认领并关闭。
8. **写死的历史窗 = 一条永久 EMPTY（从 hosted 报告里看出来，不是从代码里）。**
   `eastmoney_top_buy_sell_ticker` 的参数是 `{ticker:'600519.SH', start_date:'2026-01-01',
   end_date:'2026-09-30'}`：茅台在那段没上过龙虎榜 → 每天 `EMPTY`，而且这个窗**只会越来越旧**
   （`eastmoney_lockup_expiry` 的 2026-12-31 上界同理，2027-01-01 起也永久空）。正解不是挑一只"更常
   上榜"的股票——那还是写死。改成两件事：日期窗只写相对量 `dayShift(-30) .. dayShift(-1)`，由 runner
   每次运行按北京日历换算一次（`resolveDayShifts`，标记不会漏进生产校验）；单票代码走已有的
   `requires` / `resolveFrom` 机制，从当天真榜单首行取 `thscode`。于是"这只票在榜"由上游保证，
   `EMPTY` 只剩上游真坏这一种解释。本机国内出口 21/21 PASS 验过，窗 2026-09-11 → 2026-10-10——
   上界落在周六这个**非交易日**也没关系，靠的是 30 天的下界，这正是"前一个自然日"能成立的条件。
   顺带把同类窗（`mutual_flow` / `margin_trading` / `convertible_bond_list` / 宏观 `EM_RANGE` 的上界）
   一起换成相对量。⛔ 龙虎榜那颗的 `ticker` 键名就是 runner 注入的参数名，全表只许一处用它做 `requires`。

---

## 附：本方案里的证据来源

- 两个视角的实测数据在本文 §1，A 视角为本地直连（`node` 的 `fetch` 不走 `https_proxy`，
  实测 `220.196.226.114`），B 视角为 GitHub hosted 运行记录（一次跑完即删分支，
  远端分支/本地 worktree/临时文件均已清理，工作区 WIP 未受影响）。
- 「`validateOutput` 已在落盘前强制」：`src/data-collector/hub.ts:501`。
- 「串行 ≠ 节流」与东财风控口径：`src/net/eastmoney-client.ts:6-13`、`:38-43`。
- 「两份独立节流 = 没节流」：`src/net/eastmoney-client.ts:6-8`。
- 腾讯一条链五张面：`src/sources/tencent-public-core.ts:17-23`。
- 无重试是各家一致态度：`hub.ts` 零重试；`wind-client.ts:288-305` 只退避裸传输错误。
- 覆盖完整性断言的两个先例：`scripts/smoke-fuyao.mjs:99-103`、`test/source-normalize-contract.test.mjs`。
- 冒烟不落盘、不打印密钥：`scripts/smoke-fuyao.mjs:11-13`；OCR 预签名 URL 不带 bearer：`src/ocr/client.ts:241-249`。
- Wind 协议级探针不计费：`docs/design/wind-market-source.md:211`、`scripts/spike-wind.mjs:6-8`。
