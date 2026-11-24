# `data_analyst` 架构设计

> 状态：**设计稿（首版执行模型已被取代，见下）**。本文件定义后续实现与验收的目标，不表示 data_analyst 已启用或任何 Python 环境已可用。
>
> **2026-11-24 取代声明**：本文件的**首版执行模型**已被
> [`senior-analyst-development-design.md`](senior-analyst-development-design.md) 取代——角色改名为
> `senior_analyst`，首版改为「仓库内审查过的固定分析模块」，不再由模型编辑/运行 `analysis.py`、
> 不挂平台 shell、不直接出图。逐条对照见新文件 §0.1。
> 本文件继续作为以下内容的依据：私有 `python-runtime` 的运行时结论（§3）、按需激活与
> `analysis_data_request` 补数回路（§6.2）、run 目录可审计与不设数据量硬上限（§5、§8）、
> 以及 Phase 6 重新评估「可编辑脚本」时的信任模型论证（§2.3）。
>
> 下文凡与 `senior-analyst-development-design.md` 冲突的表述，以新文件为准；未冲突的
> 运行时、数据格式与保留期结论继续有效。
>
> 核心前提：本项目**不打包 Python 解释器或第三方库**。NumPy+pandas 是 analyst 必需依赖；设置页负责探测；自动准备/同步属 Phase 1b，需先有 DSH host 受确认的 provisioning seam，Phase 1a 只做只读检测、不承诺自动准备。两者都不在分析任务中安装/升级。用户已确认 analyst 使用平台全量 shell、可编辑 `.py`，可直接委派 one-shot 可视化专家，且暂不引入轻量数据库。
>
> **2026-11-16 勘误**：Python 运行时改为本插件私有的 [`python-runtime`](python-runtime.md)，由插件按需安装到
> `$DSH_HOME/cache/cg/python-runtime/`，不再等待 DSH host provisioning seam，也不复用系统 Python 或
> DSH Desktop primary runtime。本文 §0 第 3/4 条中“不打包、等待 host seam”的描述已被该文档取代；
> `data_analyst` 与 `run_analysis` 仍保持未启用，运行时就绪不等于代码执行面开放。

## 0. 决策摘要

1. `capital-data/datasets/<dataset_id>/raw.json` 继续作为普通 JSON Dataset 的不可变权威源；不迁移、不以 CSV 替换 JSON。新增全市场 Market Dumps 文件型数据入口，作为独立的大型 Parquet artifact 由 `data_collector` 负责采集、校验和留存，不让 analyst 自行联网下载。
2. 分析工作区按任务建立，不设 Dataset 数量或行数固定上限。宿主仅准备授权输入，普通 Dataset 提供 JSON/JSONL 和可选 CSV；Market Dump 通过可流式读取/投影的 Parquet 文件访问，不转成巨型 CSV。
3. analyst 可编辑 `analysis.py`；Python 执行走插件私有的 `python-runtime`（详见 [`python-runtime.md`](python-runtime.md)），不得用平台 shell 里的 `python`。base 包包含 NumPy 与 pandas，parquet 包可选提供 pyarrow；主 npm 包不携带解释器或三方库。普通用户不需要安装 Python、pip 或填写解释器路径。
4. 环境准备只操作插件私有缓存（`$DSH_HOME/cache/cg/python-runtime/`），不修改用户系统 Python，也不写入 DSH Desktop primary runtime；由用户在设置页显式触发，安装/升级不在分析任务中偷偷执行。`run_analysis` 仍未启用，需先完成角色授权、脚本路径校验、超时和产物上限。
5. `analysis.py`、运行环境、输入、结果和脚本/数据 hash 都可追溯；分析产物通过宿主校验和发布，派生 Dataset/artifact 始终是新的并带来源 lineage。
6. analyst 可直接创建 one-shot `visualization_specialist`，由专员使用现有 chart token 与 `render_chart` 出图；无需经过 data_junior 再创建一次。analyst 自己决定是否满足出图条件，且不直接持有 `render_chart`。
7. shell 的执行边界由 **DSH 的权限档位与沙箱执行器**负责，不由 Capital 另加闸门。本机组合挂 `dsh-bash-sandbox`/`dsh-pwsh-sandbox`（不是无约束的 `bash-local`），默认 `workspace-write`：workspace 内可写、出界写被拒，往更宽档位升级走 `approval: ask`。DSH 自身明确“file effects 是策略的全部词汇”——**读、网络、进程可见性、凭据不在其内**。analyst 因此与平台其他 bash 同档位，不额外放宽、也不额外收紧；需要强隔离时必须另立容器/VM/远程执行器，不能靠 persona 文案补足。
8. 本阶段不引入 SQLite/DuckDB 等轻量数据库。Market Dumps 本身是上游提供的 Parquet 文件格式，不代表引入数据库；只在有实际容量或查询证据时再评估数据库。

分析方向可从单标的时间序列与风险指标开始；全市场分析按用户问题/任务目标选择输入、筛选范围和精度。分析范围由主 Agent brief 的完成条件决定，不设置固定 Dataset 数量或行数上限；满足目标即停，不为“全量”而无目的遍历。

## 1. 现状与问题

### 1.1 已有数据事实

- Dataset store 写入 `raw.json` 与 `manifest.json`，以 `createIfAbsent` 发布原始数据；默认保留 7 天，单份 raw Dataset 读取上限为 16 MiB。权威实现见 `src/data-collector/store.ts`。
- `DatasetRef` 描述数据集身份、session、opaque `artifact_ref`、源能力、schema、行数、时间和参数摘要。存储 manifest 另有不返回给模型的 session scope 与可选 row key。
- Dataset 可能是顶层数组、由 manifest 指定行数组位置的 envelope，也可能是 document。并非每份数据都能自然转成表格。
- profile 由宿主从 Dataset 计算并保存至 `capital-data/profiles/<profile_id>/profile.json`，profile 最大 64 KiB；profile 包括 observed/contract schema、missing/null、quality、statistics、categories、time facts、structure 与 validation。
- `query_dataset` 执行受限 QuerySpec，只返回聚合/分组结果，不返回 raw row 投影。它不能代替逐行序列计算、窗口函数、回归样本或回测。
- `data_collector` 当前已注册 94 个 capability。Fuyao `quote` 可按 `limit` / `offset` 同步分页取全市场快照；Hub 每次执行一个 source request，不自动翻页或合并多页，每页各落一份 Dataset。另有待接入的全市场 Market Dumps（二进制 Parquet），见 §4.4。
- `DataCollectorHub` 是 FIFO 串行队列，默认最大队列长度 50、单次 source request 超时 30 秒；这两个是 Hub 的运行资源参数，不是每个任务 Dataset 数量上限。由主 Agent brief 设定分析目标，collector 按需分页，分析满足条件后停止；队列容量应作为后端拥塞保护处理，不得包装成单个用户任务的硬数据条数上限。
- 原始 rows 只在宿主受控路径内处理；Agent 间消息用 DatasetRef、profile 引用及有限摘要，不应复制完整表格。

### 1.2 analyst 当前并未实现

`preset/capital-generation/agent.patch.yml` 的 `tool-subagent-data-analyst` 仍为 `disabled: true`。它提到了 Python、coding tools、`read_profile`、`analysis.py` 与分析产物，但目前没有 Python runner、分析运行目录实现、run registry、`read_profile` 工具或派生 Dataset 接口。`test/persona.test.mjs` 有意断言这些运行能力尚未注册。

本仓 package 是 Node/TypeScript 插件；`package.json` 没有 Python runtime 或科学计算包。项目不应因此要求用户自行成为 Python 开发者：运行环境和依赖检查/准备必须由 Capital 设置页用状态、检测结果和显式确认来承载。

运行时事实已对照 DSH 官方 `deepseek-ai/deepseek-harness` 源码与本机形态核实。官方 master 核验 commit 为 `d743267388641bc76f17c45ce8b4c231aed1d32c`（0.2.1-alpha.2）：

- `packages/skill/tool-workspace-dependencies/src/index.ts` 实现 `load_workspace_dependencies`：它验证宿主提供的 `runtime.json`，返回 Python 可执行文件、site-packages 路径和 distribution 版本表，不改 `PATH`，也不是通用代码执行工具。`root` 配置会将已提供 payload 安装/复用到 Harness home；source payload 本身必须先由 carrier/宿主提供。工具不负责从零创建 runtime，也不提供 pip/包管理界面。
- `packages/profiles/sdk/cordis.patch.yml` 的 SDK profile 在有 `DSH_PRIMARY_RUNTIME` / `DSH_BUNDLED_PRIMARY_RUNTIME` 时挂载该工具。Desktop app 自己随安装包携带 primary-runtime，而其 shell/Settings provider 的具体挂载按产品 profile 接线；上述挂载事实不能推导为 Capital 所在 Web/Headless/SDK 的实际工具可见性，必须分别查询 host runtime manager/可见注册能力。
- 本机 WSL2 `~/.dsh/` 有 Web profile 配置但无 Linux primary Python payload；本机 Windows DSH 有单独的 `dsh-primary-runtime`，其 `runtime.json` 记录 Python 3.12.14、NumPy 2.3.5、pandas 3.0.1。它只证明此 Windows 安装形态目前有包，不能作为 Linux 或其他用户的保证。
- 在本次检查的官方源码/本机设置卡片中，没有发现 Python runtime 或 NumPy/pandas provisioning 的通用设置页控件/API。官方已有 SDK payload 构建/部署路径，需区分“源代码中可构建 DSH runtime”与“插件能调用一个已支持的安装服务”。

旧的 `docs/design/code-runtime-notes.md` 是未跟踪的本地调研留档，其中关于 profile 可用性/排期的日期早于以上核验；可作为历史资料，不再作为运行时现状事实或本设计的先决条件。

## 2. 目标、边界与信任模型

### 2.1 目标

- 让 analyst 在被明确委派后，能取得当前 session 授权的 Dataset、profile 与 file Dataset artifact，在 run 工作区中编辑、运行和复查 Python 脚本。
- 让 analyst **由主 Agent 按需激活**：只有当任务需要逐行计算、统计检验、回测等专业分析时才创建或复用；事实查询或只需 profile/聚合的任务不激活它。
- 让 analyst 在分析过程中**可主动追加取数**：输入不足时经主 Agent 中继向 data_collector / data_junior 补数（§6.2），新 refs 取回后在**同一** analysis 上继续，不重建角色、不重开任务。
- Python+NumPy+pandas 环境检测与受确认的托管同步能通过设置 UI 完成；普通用户无需自行找解释器或执行包管理命令。
- 普通 Dataset 从 canonical JSON 转为便于 Python 使用的 JSON/JSONL/CSV 文件，不经模型消息中转；全市场 Parquet 数据以文件型 artifact 管理，不膨胀成 JSON/CSV。
- 使每个分析运行可关联输入 Dataset/artifact、profile、脚本版本、解释器/库版本、参数、结果和派生 lineage。
- analyst 自己决定是否需要图表，并可直接委派现有 one-shot `visualization_specialist`；无需回到 data_junior 二次创建。
- 按用户目标采集与分析：brief 指定完成/停止条件，满足即停；不设单任务 Dataset 数、行数或样本条数硬上限。
- 环境或运行能力不可用时给出可诊断状态和 host 设置动作，而不是隐式降级或把普通用户扔给 shell/pip。
### 2.2 非目标

- 把 Python 与 NumPy/pandas 打进 Capital 插件包，或让分析脚本在任务里自行运行 pip/uv。NumPy/pandas 的受确认同步只允许经 DSH 管理环境流程；不向 analyst 暴露包安装工具。
- 将普通 Dataset 改成第二套权威存储；引入关系型轻量 DB、跨 run 缓存或自动索引。Parquet Market Dumps 是独立不可变 file artifact，不作为 JSON store 的替代物。
- 把原始 rows 放进 Agent 消息、shell 日志或工具回执。
- 恢复 `read_dataset_slice`，或让 `query_dataset` 暴露 raw rows。
- 将 DSH composition-wide PTC `run_code` 当作角色专属 runner；或让 analyst 直接执行取数、浏览器检索、凭据读取和交易操作。
- 由 analyst 自行交付图表或独立“最终报告通道”。analyst 可自行判断并创建 one-shot `visualization_specialist`，不经过 data_junior；面向用户的结论、证据与局限写在主 Agent 最终答复中。

### 2.3 不能掩饰的 shell 风险

用户要求的“全量 shell”意味着 analyst 能调用当前平台 shell 支持的命令、解释器与子进程。当前 `bash`/`pwsh` guard 只做调用者身份和升级字段检查，不解析命令；DSH sandbox 也不是通用读权限、出网或凭据隔离。尤其在 `workspace-write` 下，shell 代码可以直接改同一工作区里的 `raw.json`（这是该档位的既定语义，不是漏洞），也能读取 workspace 外文件、访问网络（这两项不在 DSH 的策略词汇内）。

因此必须采用**可信本机执行**口径，而不是声称工具层安全沙箱：

- 仅在用户信任本机会话、委派内容与脚本的前提下，向专用 analyst 授予 `bash` 或 `pwsh`；主 Agent 与通用 subagent 不授予该 shell 工具。
- 工具过滤和 guard 用于角色路由与阻止根会话误调用，不是文件/网络权限边界。Desktop 根侧 tool restriction 已记录为未可靠生效，不能把根 deny 当作保障。
- `inputs/`、哈希核对与结果校验可以提升可复现性、发现意外改动，但不能阻止任意 shell 修改 canonical 数据或外传内容。
- 不得把完整原始数据写进 stdout/stderr。由于 shell 回显可进入模型上下文，此规则在全量 shell 下仍是行为纪律，不是不可绕过的技术保证。
- 若需要强隔离（workspace 外不可读、网络不可达、凭据不可见、只能写 run 输出），必须暂停该信任模型，另行评估容器、虚拟机或远程执行器；不能一边授予全量 shell，一边承诺这些效果。

**DSH 权限档位实际覆盖什么**（本机 `0.2.0-rc.2` 安装态核验）。本机组合挂 `dsh-bash-sandbox`/`dsh-pwsh-sandbox`，默认 `workspace-write`，workspaceRoot = 会话工作目录：

| 维度 | `workspace-write` 下 | 依据 |
|---|---|---|
| 写 | **强制**：仅 workspace root + temp；出界写被拒并回报 denial | `dsh-bash-sandbox` README「Modes and file effects」 |
| 升档 | 需用户审批（默认 `approval: ask`），`danger-full-access` 才 `never` | `dsh-base` 的 `approval`/`permission` 行 |
| 读 | **不受限**（含 `~/.dsh/.credentials.yaml` 等 workspace 外文件） | 「File effects are the whole policy vocabulary」 |
| 网络 / 进程可见性 / 凭据 | **不在策略词汇内** | 同上，及 bash-sandbox「Known Limitations」 |

因此：**“在 workspace 内自由使用 bash”正是 `workspace-write` 的既定语义，Capital 不再叠第二道同意闸门**；用户选定的权限档位就是授权本身。Capital 的职责只有两条：不把 sandbox 宣传成读/网/凭据隔离；确保 analyst 的 shell 与主 Agent 的 bash 走同一条 `ctx.shell` → sandbox → approval 通道，既不绕过也不额外放宽。读/网/凭据隔离仍需容器/VM/远程执行器。

## 3. 运行环境与依赖策略

### 3.1 设置体验：Phase 1a 只检测；准备由宿主管理（Phase 1b）

Python + NumPy + pandas 是 `data_analyst` 的必需运行环境，但不随 Capital npm 包发布。零编程用户不应被要求手输解释器路径或执行 pip 命令；普通路径是设置页的“分析环境”面板。

**检测与 UI 通道**：设置卡片运行在浏览器侧，不能直接执行 Python、访问 workspace 文件，也不能直接调用一个模型可见的 `load_workspace_dependencies` 工具。需由 host 提供认证的 environment-status / prepare API；设置按钮经此 host 通道调用，实际 Python manifest、site-packages 路径仅留在 host。认证复用 Web route 的 request-rejection 围栏；UI API 只返回状态、版本和下一步，不返回绝对解释器路径或依赖文件内容。模型侧预检使用同一个 host runtime manager，避免检测逻辑分叉。

检测步骤：

1. **探测当前 carrier**：询问当前 DSH profile 的 runtime manager 是否有 primary-runtime payload / `load_workspace_dependencies` resolver；若有读取 host-only 的 Python 路径和 `pythonDistributions` 并运行实际 import probe 确认 Python、NumPy、pandas 可工作。manifest 记录 bundled distribution，不等于包一定能 import 成功。
2. **必要时查外部解释器**：只有用户显式启用高级选项时才查询/使用平台已安装 interpreter；普通安装路径不需要选择路径。不得把外部环境作为默认前提或对外部 venv 自动安装依赖。
3. **显示结果**：用“可用 / 缺 Python / 缺 NumPy / 缺 pandas / 版本不兼容 / 当前宿主未提供管理环境”说明状态与下一步，不要求用户理解 runtime.json、site-packages 或 PATH。

**Phase 1a / 1b 边界（已定）**：Phase 1a 只做**只读检测与结果呈现**，不承诺任何下载、安装或修复；检测通过与否决定 analyst 当前能否在该形态启用，不通过就如实显示阻塞项并保持 `disabled`。下面“推荐准备/修复决策”“自动同步建议”“必须新增的 host integration”三节描述的是 **Phase 1b**；进入 1b 的前置条件是 DSH 提供受确认的 host provisioning seam，或产品另行批准 Capital 自建 pinned-payload 安装器。未取得该能力前不实现、也不对外承诺。

**shell 权限不设 Capital 闸门（已定）**：analyst 的 shell 与平台其他 bash 共用同一条 `ctx.shell` → `dsh-sandbox` → `approval` 通道，档位由用户在 DSH 权限三档中选定，默认 `workspace-write`。Capital **不新增**同意开关、不复制 DSH 的 approval、也不在设置页重述沙箱语义；只在 README 用一句说明“分析功能在本机按你选定的权限档位运行，`workspace-write` 只约束写”。

Phase 1a 需要验证的是**不绕过**：analyst 的 bash 必须报告与同会话其他 bash 相同的 `sandbox.mode`，且不得挂 `dsh-bash-local`/`dsh-pwsh-local` 之类无约束执行器。

**推荐的准备/修复决策（Phase 1b）**：提供“准备/修复分析环境”按钮，先复用 DSH 当前 carrier 的 primary-runtime payload；如果当前 carrier 没有 payload，则由 DSH host 提供（或新增）官方受确认安装动作，使用 DSH primary-runtime lock 中已固定版本的 CPython 与 NumPy/pandas wheel。只将环境安装/缓存到 DSH home 下专属的 managed runtime 目录，不修改用户系统 Python、用户 venv、workspace 或 npm 插件包。相同 lock/payload 幂等复用；版本更新前提示并确认；准备在 staging 校验平台/架构、官方 SHA-256、解释器与必需库导入，再原子切换；失败保留旧完整环境并可重试。分析任务自身绝不安装/更新包。

自动同步建议：默认设置页按钮由用户明确确认“下载/准备或更新 DSH 分析环境”，检测本身只读；可选的“仅跟随 DSH runtime 版本自动准备”必须另行 opt-in，只同步官方 primary-runtime lock 所定义的完整环境版本，不能独立升级 NumPy/pandas 或触及用户外部环境。可回滚并提示必要的重启。

**必须新增的 host integration**：DSH 官方 `load_workspace_dependencies` 只查询/准备 carrier payload，并可将已存在的 source payload 复制/验证到 Harness home；Desktop app 会随自身分发 primary-runtime，upstream 文档说明其中 interpreter 与 NumPy/pandas wheels 由 release primary-runtime lock 固定，单个依赖不独立滚动升级。Desktop bootstrap 会在准备/启动阶段下载并校验 locked primary-runtime；Python SDK另有显式的 `download_primary_runtime()`，会下载或复用锁定的解释器、wheel 和其他运行时依赖，但 SDK 与 Desktop launcher 的下载能力并不等于任意 Web plugin 能调用的 API。本次未发现普通 plugin 可从浏览器 Settings 直接调用的通用下载/provision host API，也没有 Web profile 的 Python 设置卡片。故设置中的一键准备不是已有能力，需新增明确的 host provisioning seam（优先提给 DSH 上游提供受确认的 API）；不能把 resolver 冒充下载器。如果选择 Capital 自行实现，只能基于 DSH 官方锁定的 runtime/wheel manifest 和校验值创建独立 DSH-home 环境；不使用浮动 PyPI 版本或任意 shell/pip 安装流程。下载实现要复用/照齐官方做法：仅下载 lock 中目标平台的解释器及 wheel URL，SHA-256 校验归档，wheel 包名/版本与 manifest 一致性校验，解压 staging、执行解释器/import/`pip check` 与版本 smoke 后原子发布；失败删 staging 而保留上一完整 runtime。不能把“文件存在/哈希正确”当成 import 兼容性验证的替代。同步若失败，显示 host 错误、保留旧环境和重试动作；无 provision 能力时如实显示“此 DSH 部署不支持自动准备”，而不是要求零编程用户找路径或假装已成功。

本机 WSL Web profile 无 Linux payload，而本机 Windows DSH 有 payload；这证明 carrier 差异，不代表所有 WSL/Web/Headless/SDK 都无 Python，也不代表 Desktop 以外能用。各产品形态分别检测。

### 3.2 Python 与包的版本契约

- `numpy` 和 `pandas` 是启用 analyst 的必需库，设置检测须验证可导入并记录版本。分析开始前再按需检查，不能依赖一次装配期探测结果永久缓存。
- 本仓不打包 Python、NumPy、pandas 或其 wheels/site-packages；不修改系统 Python；不对用户选定的外部 venv 自动 pip install。
- DSH managed runtime 由 DSH 的 locked primary-runtime payload 提供 NumPy/pandas；准备工作由 DSH host/runtime provisioning 完成，不运行模型可见 shell 包管理命令、不从网页/数据内容执行安装。同步只以 host 层动作更新整套 pinned payload，不能让 analyst 遇到缺包就当场单独 `pip install pandas`。
- DSH managed payload 无法修复/下载时，使用设置的友好提示和 host 提供的安装入口；不把零编程用户丢给 Python 路径文本。若没有官方 host provisioning 操作，说明产品缺该 host integration，并维持 analyst disabled，而不是宣称可自动完成。
- `pandas` 读取 Parquet 还需要 PyArrow 或 fastparquet。Market Dump profile 将 `pyarrow`（推荐）作为全市场文件分析环境的额外必需能力，由同一 DSH-owned pinned payload 供给/检测。NumPy+pandas 状态通过但缺 PyArrow 时，普通 JSON Dataset 分析可用，Parquet Market Dump 分析明确不可用；不能从“pandas 已装”推定 Parquet 支持。
- 环境检测结果记录 Python 实现/版本、NumPy/pandas/（全市场扩展的）PyArrow 版本、来源类型（DSH payload / advanced external interpreter）和检测时间；不记录密钥、私有 package index 或绝对用户路径。缺依赖返回稳定错误 `python_runtime_unavailable` / `python_dependency_unavailable`，停止受影响分析并给出可执行的设置动作。

### 3.3 可复现元数据

每次执行 attempt 至少记录：Python 实现与版本、OS/架构、runtime 来源类型与 payload digest（若有）、NumPy/pandas 版本、额外依赖及版本、脚本 SHA-256、输入 Dataset/Parquet artifact hash、参数、启动/结束时间、退出码、stdout/stderr 字节数，以及是否因异常/超时终止。路径本身不进 Agent 消息；manifest 不应默认暴露用户目录绝对路径。

外部环境不是锁定依赖镜像，故记录版本只能帮助复现，不保证不同机器 bit-for-bit 相同。金融计算方法还必须明示算法版本、数据频率、方法假设、精度和舍入；复权与日历预处理等已有数据职责不得在分析脚本里重复实现。

### 3.4 候选分析模型：Kronos（调研留档，未采纳）

**先划边界：这一节不改变任何前置条件。** Kronos 不进 §3.2 的必需依赖集、不进任何 requirements 清单、不作为启用 analyst 的理由，也不因为记在这里就获得排期。记它的原因只有一个：它是目前唯一有明确出处的候选，能填上我们**唯一真正空白的能力**（逐行时序 / 概率情景生成）。

那道空白是实测过的，不是印象：按 catalog 现算的 67 颗外部 Skill 全量正文（133 份 `.md`）里，"Kronos / 时序预测模型"零命中；同一张表上情绪打分有 24 颗、信号强化-弱化-证伪 25 颗、传导链路 5 颗。**空白不是漏收，而是我们根本没有"跑模型"这条通道**——所以它的落点只能是 analyst，不可能是某颗 `SKILL.md`：正文只能教 Agent"去做这件事"，做不做得成取决于宿主有没有那个面。

核验到的事实（2026-10-13，`shiyu-coder/Kronos` @ `master`，40,618 星，最后推送 2026-04-13）：

- **它是什么**：金融 K 线的开源基础模型——先把 OHLCV 量化成 token，再用大自回归 Transformer 在 **45 个以上全球交易所**的数据上预训练；论文 arXiv:2508.02739，已被 AAAI 2026 接收。家族分档：mini 4.1M（context 2048）、small 24.7M、base 102.3M（两者 `max_context` **512**，`KronosPredictor` 对更长上下文自动截断）、large 499.2M **未开源**。
- **许可三层都干净**：代码 `LICENSE` 是 MIT（`Copyright (c) 2025 ShiYu`，署名已填）；Hugging Face 上四个权重仓（`Kronos-mini` / `-small` / `-base` / `-Tokenizer-base`）的 cardData 均标 `mit`；finetune 示例取数用的 `microsoft/qlib` 也是 MIT。**接它不需要像 Apache-2.0 那样补 4(b) 声明行**，但仍要进 `THIRD_PARTY_NOTICES.md`。
- **代价是 torch，而不是一行 import**：上游 `requirements.txt` 里 `torch>=2.0.0`、`einops`、`huggingface_hub`、`safetensors`、`matplotlib`、`pandas==2.2.2`。我们 §3.2 的必需集只有 NumPy/pandas（全市场扩展再加 PyArrow），由 DSH locked primary-runtime payload 供给；**torch 与 HF 权重不在任何 DSH lock 里**，接它等于新开一条依赖供给路径（走 §12.1 的 host provisioning seam）并新增一条出网（`from_pretrained` 从 HF Hub 在线取权重）。这与"不打包 Python 库""不在分析任务里安装"两条前提直接冲突，必须先解决供给，再谈能力。
- **合规红线比技术更硬，要预先定死**：Kronos 的输出是**对未来 K 线的采样值**（`predict(..., T, top_p, sample_count)`，另有 `predict_batch`）。这与本插件既有的表达纪律正面相撞——不承诺收益或准确率、取不到就报缺不许用记忆回填（同一份 `docs/dev/selected-skills.md`，§8.6 第 2 与第 7 条）。**若真接，只能定性为方法推演与情景生成**：产物必须带采样温度、样本数、历史窗口与 `max_context` 截断事实，进 `result.json` 的 lineage 与方法假设（§3.3），且**不得以"预测价 / 目标价"的形态进入主 Agent 最终答复**。上游 README 的 finetune 一节自己就写了这句，可直接引用，不必我们替它下结论：*"This pipeline is intended as a demonstration … It is a simplified example and not a production-ready quantitative trading system. A robust quantitative strategy requires more sophisticated techniques, such as portfolio optimization and risk factor neutralization, to achieve stable alpha."*
- **A 股侧的真相**：上游给的 finetune 示例恰好是**用 Qlib 准备中国 A 股数据并做简单回测**——这是它与我们的天然接口，也是"45 个交易所预训练"不能替代它的理由：预训练覆盖不等于在境内市场有效，而境内市场有涨跌停、T+1、停牌与复权口径，512 根 K 线的上下文上限还会与我们的 as-of 日期纪律（§1.3）打架（一年日频约 240 根，512 根只够两年多）。finetune 本身要多 GPU `torchrun` 与 pickle 数据集，那条训练路径我们**不该碰**。

**已经见过的一种错误接法，值得留档**：`RKiding/Awesome-finance-skills`（Apache-2.0，3067 星）就是把 Kronos 当一颗 skill 发：`alphaear-predictor/SKILL.md` 让 Agent `from scripts.utils.kronos_predictor import KronosPredictorUtility`，随包带一份 1.28 MB 的 `kronos_news_v1_*.pt`，并把整套 runtime 在每颗 skill 里各 vendored 一份（139 个 `.py` / 1.08 MB，唯一内容只有 59 份）。它文档里那句 "We use `weights_only=True"` **只对一半**：5 个 `torch.load` 调用点只有 1 个带 `weights_only`，同一个 `try` 的 `except` 分支回落成裸 `torch.load`，选文件用的是 `max(glob("kronos_news_*.pt"), key=os.path.getctime)`；再加上 "Or depend on the base model (automatically downloaded)" 这句——真正的供应链面是运行期从网络取权重，不是仓内那个（其 pickle 载荷本身是干净的，只有 `_rebuild_tensor_v2` 一类重建器）。**结论形状：把模型能力写成 skill 正文，得到的是"教 Agent 去撞一堵墙"，而墙后的风险反而先进了包。**

**重启这条调研的触发条件**（三条同时成立才谈，否则继续留档）：① analyst 的 Phase 1a 在**至少一个产品形态**端到端跑通（NumPy/pandas 检测通道 + `read_profile` + 一条真实分析验收）；② 出现 `query_dataset` 聚合与少量派生算术确实覆盖不了的逐行/序列/概率情景需求；③ 决定接受 torch + HF 出网这条依赖供给路径（由 DSH host seam 提供，不是 pip、不是运行期自动下载）。届时先做的仍是**只读探测与一个小样本回测**，不是接权重进包。

## 4. 数据格式与物化规则

### 4.1 分层

```text
data_collector
  -> canonical JSON Dataset / Market Dump artifact
  -> data_junior                                      profile、质量检查、交易日历/缺失/异常标记、年化口径
  -> prepare_analysis_workspace                      授权校验 + JSON/JSONL/Parquet 输入准备
  -> capital-analysis/runs/<analysis_id>/             可编辑脚本 + attempt + 结果
  -> data_analyst + DSH/user-provided Python          专业分析与方法假设
  -> data_analyst -> visualization_specialist        必要时直接 one-shot 出图
  -> finalize/publish                                 结果校验、派生 Dataset/Artifact 发布
```

JSON canonical 是可审计事实；run 文件是临时/保留期受控的计算输入副本；CSV 是方便互操作的投影。三者不能混为同一套“数据库”。

### 4.2 每种形状如何导出

每个授权 Dataset 在 run 目录中分配一个由宿主生成、符合安全命名规则的 alias（例如 `price_history`），不得让模型提供路径片段。

```text
inputs/<alias>/
  source.json           原始 JSON 形状（保留 array/envelope/document）
  rows.jsonl            仅行型 Dataset：按 manifest row_key 解析出的每行 JSON
  table.csv             可选：仅简单标量行
  schema.json           profile/schema 及字段、类型和时间轴说明
  manifest.json         dataset/profile 身份、输入哈希、导出语义与时间
```

- `source.json` 是 JSON 形状的副本，适合需要保留 envelope 或 document 结构的分析。宿主应按 store 授权后读取，不让 Agent 自行拼 `capital-data` 路径。
- `rows.jsonl` 只为 `array` / `envelope_item` 形状生成；每个逻辑 row 写成一行合法 JSON，保留嵌套结构、字段缺失与显式 null。它是行分析的默认输入，Python 标准库可逐行读取，不要求 pandas。
- `table.csv` 只为明确可扁平化的结构生成：每行须为对象、列为平面标量，不能把对象/数组静默序列化后伪装成普通列。遇到嵌套列或不一致结构可跳过 CSV 并在 manifest 记录原因；不能因此阻断 JSON/JSONL 分析。
- CSV 是有损互操作视图：空值、缺失、字符串/数字、日期格式等区分可能在一般 CSV 工具中折叠。必须写明编码、列顺序、分隔/引号和 null/missing 映射，并在 manifest 标注 `lossy=true`。需要精确语义时以 JSONL/JSON 为准，不得仅凭 CSV 反推原始类型。
- `document` Dataset 只物化 JSON 与 schema/profile，不生成假表 CSV/JSONL。
- `file Dataset`（Market Dump）由 `data_collector` 只下载/落盘一次，放在内容寻址或版本化的 workspace artifact 目录。每次 run 的 `inputs/<alias>/manifest.json` pin 对应 `file_dataset_id`、hash、覆盖区间及授权的 workspace-relative `data_path`；analyst shell 从 run manifest 读取该路径，避免把大 Parquet 每个 run 重复拷贝。该路径只存在于 run 文件，不进入委派消息。reader 用 PyArrow/受支持的 Parquet reader 做 column projection 与 row-group streaming。专用文件型 reader 和权限 API 尚需实现；hash 校验是意外修改检测，不是针对全量 shell 的写权限隔离。
- 每份输入 manifest 记录 `dataset_id`、`profile_id`（可选）、任务与 session 绑定、源 `artifact_ref`、原始形状、`row_key`、row_count、format、UTF-8 内容字节数、哈希、捕获时间、保留截止时间、CSV 投影状态及警告。原始完整 rows 不进入 manifest。

### 4.3 角色职责与金融数据口径

**数据清理与日历准备由 `data_junior` 负责，专业方法计算由 `data_analyst` 负责。** 不另起一套重复清理管线：

- `data_collector` 按能力契约取数并披露来源本身的调整口径。若请求的是已复权历史序列，collector 返回对应口径；analyst 不把同一份价格再应用 corporate actions/adjustment factors。需要转换口径时先明确请求原始价格/调整事件，再由经审定的数据流程处理，不在单个分析脚本里偷偷重算。
- `data_junior` 读取交易日历、profile 与数据质量结果，检查预期交易日覆盖/缺失交易日、排序/重复和异常值，提供交易日年化因子或适用口径。异常值默认标记并披露，不擅自删除、winsorize 或替换。`data_analyst` 消费这些事实；只有任务目标明确要求敏感性分析时，才按指定规则对异常/缺失值做派生处理并记录规则，不重做常规 data quality gate。
- `data_analyst` 承担需要其专业计算的收益分布、波动/回撤、统计检验、事件研究或回测方法等；算法的输入与约定必须由 brief 或协议声明，结果带方法版本与假设。
- 风险自由利率尽量由 collector 从已注册、契约可靠的数据源单独获取。A 股日频研究的 v1 默认假设建议用人民币短期限（3 个月）国债收益率作为代理，采用每个收益观察区间开始时最新可用的曲线点位，不用 10 年期长端收益率代替短端资金机会成本；这只是透明、可配置的代理，不是“无风险资产”的精确定义，需披露期限风险与基准。ChinaBond 官方曲线包含 3 个月、6 个月、1 年等期限，说明曲线每工作日日终发布；但目前本仓没有对应结构化 capability，必须先验证可重复、许可允许的取数接口，不能抓页面就假设可当生产数据源。若曲线年化收益率按有效年率口径确认，则区间无风险收益可按 `(1 + y_annual)^(calendar_days/365) - 1` 转换；若上游契约是其他计息/复利口径，则依契约替换，不能套公式。缺失或超过 freshness 的前值不可无限期前向填充，需披露/停止该项指标。`data_junior` 提供交易日年化因子与观察区间日历事实；analyst 按该事实计算年化 Sharpe/波动，不自行定义 252/365 再造一份口径。若利率数据不可用或没有适当期限/频率，analyst 可在 brief 许可下采用另一明确代理/情景，并记录来源、tenor、频率转换、日计数/复利、日期对齐与限制；未取得可辩护利率时，不能将 rate-dependent metric 默认为“无风险利率 = 0”而不披露。
- 以上职责并不阻止用户明确要求 analyst 在专业研究中重核某个质量问题；此时应把它作为独立研究方法/敏感性分析，与 data_junior 的质量事实并列，而不是覆盖 junior 的原始 profile。

### 4.4 全市场 Market Dumps：传输事实与接入路径

当前 Fuyao capability 表记录 94 个已注册能力，Market Dumps 仍**未接入**。现有 `quote` 提供的是全市场实时快照分页 JSON（同步，一次请求一页），不是全市场十年历史下载。

官方接口文档列出三个 dump：`daily-k`（约 10 年全市场未复权日 K）、`daily-k-10d`（近 10 个交易日增量日 K）和 `adjustment-factors`（全市场复权事件）。端点 `GET /api/dump/market-dumps/<kind>/download-url` 返回有短有效期的预签名 URL，随后客户端对该 URL 直接 GET Parquet 文件。官方流程没有任务 id、状态端点或轮询步骤；“下载文件可能耗时”不等于上游异步 job。仓内已有 submit → poll → fetch 的异步流程是 PaddleOCR，与 market dumps 无关。

将 Market Dumps 纳入 `data_collector` 的未来结构化采集设计，不让 analyst 使用 shell 直接请求 API，也不在 analyst run 每次临时下载一份。下载/读取需要宿主数据管线提供一个与 JSON Dataset 并列但明确区分的**文件型 Dataset artifact**：

```text
data_collector -> 请求签名 URL -> 限时下载 Parquet -> 校验响应/manifest/hash/大小
              -> 不可变 parquet artifact + manifest + file DatasetRef
              -> data_junior profile (流式 schema/coverage/quality facts)
              -> data_analyst 按需投影/过滤/分析
```

实施前至少要确认：

- Fuyao 授权、速率、错误码、URL 到期、HTTP 重定向和 TLS/host allowlist；预签名 URL 视为短时 bearer secret，不能进 Agent 消息、工具结果、日志、DatasetRef 或重试提示。
- 下载到临时文件后校验长度、格式、Parquet footer/schema、manifest 的 row_count/覆盖区间和 SHA-256，再原子发布 artifact manifest；中断文件不能伪装成 Dataset 成功。下载重试需要重新签 URL，不能重用过期链接。
- 当前 `WorkspaceDatasetStore` 只接受 JSON `data`、单份 raw 读上限 16 MiB；因此须新增文件型 artifact store/API（streaming I/O、单独容量与 retention 规则），不能把几百万行 Parquet 读进 JS 内存再 `JSON.stringify`。
- profile 应能流式扫描列、行数、重复 key、覆盖范围及质量；对 analyst 的 Python reader 必须确认 PyArrow 或另一受支持 reader 实际可用。NumPy/pandas 必需环境自身不保证 Parquet reader。
- `daily-k-10d` 可作为近期增量，但要实现按 `(thscode,date_ms)` 的更新/重叠处理；10 年 dump 可用于首次完整覆盖/恢复。canonical 文件需保留来源 dump id/version/hash/捕获时间；在同一 artifact 中合并版本前需设计不可变版本与去重策略。
- 按 brief 的目标决定取全量、增量或某些日期/样本；不设任务数据份数上限，但总传输体积、磁盘配额和同时下载/处理资源须有系统级可观测预算与取消能力。

当前不覆盖表中列出 dump/Parquet，原因是独立二进制下载、验证、存储和 Parquet profiling 尚不存在；这是一条**待落实的采集能力**，不是异步轮询 API，也不是永久拒绝接入。

### 4.5 Profile 与时间口径

分析请求携带的每个 `profile_ref` 必须指向同一 Dataset、同一授权 session/workspace，且未过期。profile 在本项目中可能重复生成；run 必须 pin 一个精确 `profile_id`，不能只写“最新 profile”或在执行中自动换版。

`read_profile` 是未来要实现的受控宿主工具：通过 `profile_id`/opaque ref 找 profile，再通过关联 Dataset manifest 验证 session scope、workspace、Dataset/profile 关联及 retention。不能只相信 profile JSON 自报的 owner 字段；profile 不携带足够 owner 信息时，应从 Dataset 权威 manifest 派生授权。profile 不含 raw rows。

涉及日期窗口时复用 `src/data-collector/query-time.ts` 的现有日期归一与 `resolve_data_time_range`；时间列的单位、时区和对齐方式读取 pinned profile 的 `time_facts.axis`。不得在 persona、skill、Python helper 或第二个 TS 入口复制一套 epoch/时区推断。若 profile 无法确定时间轴，失败或请求补充明确口径，不猜测。

## 5. Run 工作区和状态

### 5.1 目录布局

```text
capital-analysis/runs/<analysis_id>/
  manifest.json
  inputs/
    <alias>/source.json
    <alias>/rows.jsonl
    <alias>/table.csv
    <alias>/schema.json
    <alias>/manifest.json
  analysis.py                 analyst 可编辑的工作脚本
  attempts/<attempt_id>/
    script.py                 本次执行时脚本快照
    result.json               脚本结构化结果
    stdout.log                有界；不得写原始 rows
    stderr.log                有界；不得写凭据/原始 rows
    attempt.json              环境、参数、哈希、退出码、时间与错误
  outputs/
    derived/                  待宿主验证并发布的数据文件
    artifacts/                有明确类型和大小上限的分析附件
```

`analysis.py` 是可编辑源文件；每次运行前先复制成不可变 attempt 快照并计算哈希，避免“结果对应哪个脚本”无法回答。agent 可多次编辑、重跑；每次 attempt 使用不同 id，不能覆盖旧 attempt 的 result/log/manifest。run 根 manifest 记录当前状态、输入和活动 attempt；产物先写入，完整性记录最后提交。半写入/损坏 manifest 必须视为错误，不能当成“run 不存在”静默重跑。

`report.md` 不作为独立交付通道。面向用户的最终结论由主 Agent 撰写；分析 run 可保留受限 `result.json` 与附件用于复核。analyst 根据主 Agent brief 判断是否出图；需要图表时直接通过 `prepare_chart_source` 向当前 issuer session 签 token，再创建 one-shot `visualization_specialist`。专员使用现有 `render_chart` 交付；不经过 data_junior，也不建立第二套图表实现或交付旁路。

### 5.2 建议状态机

```text
created -> preflighted -> materialized -> editing -> running
                                            ^          |
                                            |          v
                                      retryable <- validating -> completed
                                                         \-> failed

editing/running --(analyst 发 analysis_data_request)--> data_pending
data_pending --(主 Agent 中继补数 + 补 profile，同一 analyst 收到新 refs)--> materialized
data_pending --(范围外 / 超预算 / 数据不可得)--> partial / failed
```

`data_pending` 不是新角色、也不是新 run：同一 `analysis_id` 下 analyst 保持 continuable，收到新输入后回到 `materialized` 续跑；已成功的 attempt 与产物不因补数失效，补数后的执行以新 attempt 记录新增输入哈希。

实现时应把 `cancelled`、`expired`、`integrity_error` 作为明确终态/原因处理，不能混成成功。错误至少区分：Dataset/profile 不存在/过期/越权、profile 与 Dataset 不匹配、数据形状不可支持、Python runtime 不可用、依赖缺失、脚本非零退出、超时/资源上限、结果 JSON 无效、输出 schema 不符、派生 Dataset 发布失败、源内容哈希变化。

失败 attempt 保留可诊断信息和已有 artifact refs；重试创建新 attempt，不覆盖源输入或成功结果。相同 `analysis_id` 重试必须验证原始输入/脚本选择，不能重复发布同一派生 Dataset 或制造歧义。实现需定义幂等 key 与发布顺序。

### 5.3 保留

输入 Dataset 默认保留 7 天。建议 run 的到期时间取 `min(run_created_at + 7 days, earliest_input.retention_until)`，不因物化副本而延长原始数据的保留期；manifest 明示该时刻。派生 Dataset 若需要不同保留策略，必须在派生 manifest 中说明 lineage 对已过期来源如何解析，不能静默延长源 Dataset。当前 store 没有物理删除/定时清理保证，故 `retention_until` 首先是逻辑失效时间，清理实现另设任务，不能声称文件到期自动删除。

## 6. 工具、协议与产物契约

### 6.1 职责分工

未来由宿主注册真实工具，再把真实名字加入 analyst 的 allowlist。概念职责如下（名称是设计草案，不代表已注册）：

- `inspect_dataset` / `query_dataset` / `resolve_data_time_range`：复用现有元数据、聚合和时间区间能力；不能变成 raw-row 工具。
- `read_profile`：读取并验证指定 profile 的有限内容。
- `prepare_analysis_workspace`：校验 `task_id`、DatasetRef、profile refs 与 caller session；建立 run 并物化文件；只返回 analysis id、相对 opaque refs、结构/行数/大小摘要和警告，不返回 rows。
- 平台 shell：仅 analyst 可见，允许创建/编辑/执行 run 中 `.py`。DSH 0.2.1-alpha.2 官方源码记录的默认 executor budgets 为前台 120 秒、单次覆盖上限 600 秒、stdout/stderr 各 64,000 字节内存输出后 spill（每流最多 64 MiB）及 3 秒终止/排空宽限；命令超时后是否提升成后台 job 取决于 `tool-jobs`/`promoteOnTimeout`。Capital 当前 shell rows 明确 `enableRunInBackground:false` 且未挂 `dsh-tool-jobs`，故当前实际采用前台执行；超时就失败，不依赖轮询。要允许长任务续跑，后续须显式接入 jobs registry/tools、job owner 与取消语义，并用其 `job_output`/completion notice，不忙等轮询。
- `prepare_chart_source`：分析子 Agent 使用现有接口为授权的行型/派生 Dataset 签发 chart token。token 的授权一跳规则允许 specialist 作为 analyst 的直接子 Agent 使用它。
- `subagent_visualization_specialist`：one-shot child，接收 task、profile 引用、有限摘要、视图意图与 `chart_source_ref`，只持有 `skill` 和 `render_chart`。analyst allowlist 有专员创建权限但没有 `render_chart`；图表数据仍由宿主持有和呈现。
- `finalize_analysis`（或等价宿主 API）：读取该 run 的 `result.json` 与输出清单，校验 schema、大小、无损 JSON 和 lineage，然后将允许的结果发布为不可变 Dataset/artifact；不信任脚本自行写的 manifest。

上述宿主工具的 session extraction 必须使用 `src/tool-exec.ts` 的 `delegatedSession(exec, toolName)` 与真实 `exec.agent.session` 形状；授权不允许靠绝对路径。写入复用 `WorkspaceDatasetStore` 的 containment/sandbox policy 模式。所有新模型工具必须经 `apply()` 注册，并使用根 `jsonObject()` schema 与实测输出契约。

### 6.2 委派与回传

请求沿用现有 direct-child、continuable、主 Agent 中继边界；请求只带 opaque 标识、问题与约束：

```json
{
  "type": "analysis_request",
  "task_id": "task_...",
  "dataset_ids": ["ds_..."],
  "profile_ids": ["p_..."],
  "question": "分析近一年收益、波动和最大回撤",
  "constraints": {
    "must_show_method": true,
    "must_report_limitations": true
  }
}
```

不得包含 raw rows、用户本地任意路径、绝对路径、密钥或可执行代码片段。data_analyst 可在 run workspace 内创建/修改脚本；文件路径由宿主生成，不由委派消息控制。

分析中途发现输入不足时，analyst 用既有 `send_message` 向主 Agent 发补数请求——**不新增取数工具，analyst 仍不持有 `request_data` / `list_capabilities`**：

```json
{
  "type": "analysis_data_request",
  "task_id": "task_...",
  "analysis_id": "an_...",
  "need": "近 3 年该标的日频成交额与换手率，用于流动性约束下的回测",
  "blocking": true,
  "already_have": ["ds_..."],
  "suggested_query": { "topic": "...", "time_range": "last_3_years", "fields": ["amount", "turnover_rate"] }
}
```

规则：

- 主 Agent 是补数的**范围闸门**：只转交在 brief 目标/验收条件内的请求；范围外或目标已满足的请求直接拒绝并说明。§8 的“不设上限”指不设人为硬顶，不等于无目标遍历。
- `blocking: true` = 没有这份数据就无法给出结论，主 Agent 优先处理；`false` = 可选稳健性/敏感性补充，允许在预算内延后或放弃。
- 主 Agent 转 data_collector 取数、data_junior 补 profile，再把**新的 DatasetRef / profile ref** 发回**同一个** analyst（continuable 复用，不新建同角色）；相同 `task_id + dataset_id` 不重复派发。
- 补数请求与回传同样不得携带 raw rows、绝对路径或密钥；analyst 只接受新的 opaque refs，不接受“文件路径”形式的补数。
- 补数失败走既有 `data_failed`；analyst 据此降级为 partial 或改用已有输入，不因一次补数失败而假装完整。
- **暂不设补数轮次硬上限**（与 §8“不设人为硬顶”一致）：以 brief 完成/停止条件 + §8 系统预算为界。若出现明确 bad case（连续 `blocking` 补数而结论不收敛、同一缺口重复索要等），再评估软闸，不在没有证据前预设。
- **收尾时序**：只要还存在未决的 `analysis_data_request`（尤其 `blocking: true`），主 Agent **不得写最终答复**；必须先满足它，或让 analyst 明确降级为 partial 并给出阻塞证据。与 `docs/dev/data-roles.md` §1.4 的结算对账同源。

成功回传应是小型结构化摘要：`task_id`、`analysis_id`、所用 Dataset/profile IDs、方法及版本、结果摘要、警告/局限、`script_ref` / `result_ref`、派生 DatasetRefs、各源内容哈希状态。失败回传包含稳定 `code`、失败阶段、是否可重试、已有 refs 和下一步。Agent 消息不传 stdout/stderr、完整 JSONL/CSV、整份 profile 或大附件。

工具出参必须满足自身 `output.schema` 且是无损 JSON；任何 `undefined`、NaN/Infinity、数组空洞或未声明字段都应在宿主发布前拒绝。面向 Agent 的完成回执继续服从现有 `SAFE_RESULT_CHARS = 7000` 单道体积闸门：超限返回小回执与收窄/读取 artifact 的提示，不另造多层裁剪策略。

### 6.3 `result.json` 与派生 Dataset

建议的最小结果信封：

```json
{
  "schema_version": 1,
  "analysis_id": "an_...",
  "task_id": "task_...",
  "status": "completed",
  "methods": [
    { "name": "simple_return", "version": "1", "parameters": { "price_column": "close_price" } }
  ],
  "summary": "…",
  "metrics": { "total_return": 0.12, "annualized_volatility": 0.23, "max_drawdown": -0.18 },
  "warnings": [],
  "limitations": []
}
```

Schema 要闭合并有大小上限。所有数值必须有限、单位/周期明确；缺失、不适用与计算失败不能都写成 `0`。时序输出可包含派生行文件，但发布前宿主验证字段、row_count、类型、时间轴与输出体积。

派生结果不得覆盖或修改 `raw.json`，只能由宿主创建新的不可变 Dataset。派生 manifest 至少记录 `derived_from`（一份或多份 Dataset id）、analysis id、task id、方法/算法版本、参数摘要、脚本 hash、输入 hash、runtime 版本、创建时间、schema 与 row shape。发布失败不能回报成功，也不能留下一个看似有效但缺 manifest 的 Dataset。原始 rows 不经 `send_message`；小型指标可以进入结果摘要，派生序列通过新 DatasetRef/opaque artifact ref 供下游按权限读取。

## 7. 第一阶段工作流与错误语义

```text
1. 主 Agent 定义 task_id、目标/验收条件和停止条件，预检后委派 collector 与 junior；analyst **按需激活**——只有任务需要逐行计算/统计/回测等专业分析、且已有至少一份可用 Dataset/profile 时才创建或复用（见 §9）
2. data_collector 按目标选择来源、按需分页，立即落 DatasetRef；任务消息不能把 job/分页误当 analyst 的数据集总数上限
3. data_junior 对数据完成 profile、缺失交易日/异常值 flags、交易日年化事实等质量与准备判断
4. data_analyst 核对目标和引用，设置页/调用期检查 Python、NumPy、pandas；不可用则点名阻塞项
5. 宿主校验授权、profile 关联与时间轴，创建 run；普通 Dataset 物化 JSON/JSONL，Market Dump 使用授权 Parquet artifact reader
6. analyst 按目标选择足够输入，编辑 analysis.py 并执行；仅将简短状态写 stdout/stderr，结构化结果写 result.json
7. analyst 若判断输入不足，发 analysis_data_request（§6.2）；主 Agent 判定在 brief 范围内后转 collector 补数、junior 补 profile，把新 refs 发回同一 analyst，回到步骤 5/6 续跑；范围外或已满足则拒绝并说明
8. 宿主校验退出码、attempt/source hashes、结果 schema 与派生输出，再发布新 Dataset/artifact
9. 若 analyst 判断需要分析图，调用 prepare_chart_source 并直接创建 one-shot visualization_specialist；等专员回 chart_ref/失败回执
10. 目标满足即停止继续取数/分析；未满足则回报 partial、阻塞证据与下一步，不为“全量”而无目标地遍历
11. analyst 将摘要、证据 refs、图表 ref、警告、假设和局限经主 Agent 回传；主 Agent 对账结算后综合最终答复——**存在未决 `blocking` 补数请求时不得提前写结论**（§6.2）
```

不支持的数据形状、所需依赖缺失、profile 不一致、日期轴未知、脚本退出非零或输出无法验证时，分析必须明确失败或部分完成；不得只因脚本产生了一个文件就判成功。可恢复错误由 `analysis_id` 下的新 attempt 执行；输入/环境不变时可复跑，环境或输入改变则新版本/新 run 并记录差异。分页、不同能力或 Dataset 数目以任务目标为准，不设固定总数上限；后端 FIFO 队列满或系统级磁盘/时间预算耗尽时给出明确资源错误并可续做。
建议稳定错误码（具体名称在实现时纳入工具 schema）：

- `analysis_dataset_not_found` / `analysis_dataset_expired` / `analysis_session_mismatch`
- `analysis_profile_mismatch` / `analysis_profile_expired`
- `analysis_shape_unsupported` / `analysis_time_axis_unknown`
- `python_runtime_unavailable` / `python_dependency_unavailable`
- `analysis_script_failed` / `analysis_timeout` / `analysis_resource_limit`
- `analysis_result_invalid` / `analysis_output_schema_mismatch`
- `analysis_source_integrity_changed` / `analysis_artifact_write_failed`

工具失败应由宿主按项目既有方式抛出带 code 的错误（`isError` 语义），不可返回普通 `{ok:false}` 伪装成功。Agent 间的 `analysis_failed` 消息可以承载上述 code 与错误阶段。

## 8. 资源与完整性

普通 JSON Dataset 当前有 16 MiB 单文件读取闸门；这不是单任务数据量上限。Market Dumps 若纳入则另走流式 Parquet 文件型 artifact，不按此 JSON 单文件额度切碎或反复分页。**不设置单 run Dataset 数、总行数或统计样本数硬上限**：主 Agent 给出目标与完成判据，collector/analyst 按需取/读，满足目标后停止；证据仍不足时标出 partial 和具体缺项。

运行时仍需保护宿主整体健康：对同时运行进程数、每次下载/单 artifact 最大字节、磁盘总配额、shell wall time、内存/CPU、stdout/stderr spill 和派生输出体积设置系统级容量预算。容量应在 DSH shell/FS/Parquet reader 实测后定义，并以可暂停/取消、保留检查点或重试方式响应；不能把它们改写成“每任务最多 N 份数据”。

由于 full shell 可绕过宿主 API，输入哈希检查只用于**发现**运行中 source 文件是否变化：

- 物化前后及分析后核对 canonical 文件哈希；任一 source 被改动时以 `analysis_source_integrity_changed` 失败并通知主 Agent。
- 不自动把已修改文件覆盖回原内容，不以 hash 相同之外的协议保证“未修改”；不要把 raw 文件的可写性问题藏起来。
- run 输入副本也可被脚本篡改。attempt 需记录物化哈希及执行前哈希，分析结果同时记录脚本/输入哈希，校验失败时不发布派生数据。
- 若未来需要“从结构上保证 canonical 数据只读”，必须切换到进程/OS 隔离执行面；同一工作区的完整 shell 不可能同时提供该保证。

stdout/stderr、result 与派生文件需要独立字节上限。shell 调用输出不得打印表格；宿主截断日志也要显式标记 truncated，不能让 Agent 误以为输出完整。shell 工具本身的超时/输出上限必须先对实际 DSH 版本查证；未查证前不能把某一运行参数写成既有能力。

## 9. 角色可见工具与装配要求

- `data_analyst` 是主 Agent 的 direct child；拥有创建一个 one-shot `visualization_specialist` 的专用权限。它可与 `data_collector` / `data_junior` 互通，但由主 Agent 中继；补数走 §6.2 的 `analysis_data_request`，不直接调用取数工具，不需要委派 data_junior 代为创建图表专家。
- analyst allowlist 只包含**真实注册**工具：`send_message`、`skill`、必要的 Dataset/Profile/时间工具、分析工作区管理工具、平台 shell、`prepare_chart_source` 和 `subagent_visualization_specialist`。必须实现 `read_profile` 后再允许；未知名字可导致 child 创建失败。
- analyst 不持有 `render_chart`；它只签发给自己的直接 specialist 的 chart token。token 绑定 analyst 的 session/task/workspace，specialist 在允许的 `maxDepth: 2` 下直连且仅能使用 `skill` + `render_chart`。主 Agent root gate 仍 deny render/token/specialist 创建工具。
- `data_analyst` **不进每轮强制预检**，由主 Agent 按需激活：只有任务需要逐行计算/统计检验/回测等专业分析、且已存在至少一份可用 Dataset/profile 时才创建或复用；事实查询、只需 profile/聚合的任务不激活。激活前两道门：① 环境检测（Python/NumPy/pandas）、分析工具与图表链路齐全；② 分析目标、完成/停止条件与是否需要图表已写进 brief。任一不满足就不创建或启动。
- 通用 `subagent` 必须 deny 分析产物写工具、Dataset 专用工具、shell、专用 analyst 创建工具和图表 pipeline。不可通过通用 child 绕过角色链。
- shell 的 bash/pwsh 平台成对行要与 guard / deny / analyst allow 完全一致；不在 `src/` 用平台分支跳过测试。若真实 DSH 产品形态不能保证 analyst 及 specialist 的角色工具边界，则先不启用 analyst。
- 不得将 `data_analyst` shell 的读取范围宣传成只限 `inputs/`；在当前 shell/sandbox 下这是不成立的。

## 10. 分阶段实施与验收

### Phase 0：DSH 与设置接入核验

- 对照锁定/支持的 DSH 源码版本和产品 carrier，确认 Web、Headless、Desktop、SDK 各自的 runtime payload、`load_workspace_dependencies` 可见性与版本表，不用一个 profile 推断另一个。
- 核验是否存在 DSH 官方“准备/下载/升级 primary runtime”的宿主 API 或用户动作；检测工具本身不是安装接口。若没有可调用的 host provisioning，先与上游确定设置按钮的实际操作入口，未解决前不承诺自动安装。
- 在 Linux/Web 与 Windows Desktop 实测 analyst shell 名、工作目录、workspace-write、输出 spill 文件可读性、前台超时/进程杀停、图表 token 从 analyst 到专员的 scope；当前 Capital preset `enableRunInBackground:false`，明确不把通用 jobs 契约当作当前可用。
- 用 DSH 官方管理 runtime 或本机候选只读检测 Python、NumPy、pandas；覆盖安装、缺 runtime、缺一库、版本不兼容、同步中断回滚。普通用户流必须完全能通过设置 UI 操作，不要求 shell/pip。
- 若某产品形态无 Python managed runtime 且没有受支持的 provision 入口，设置中如实标记不可用，并保持 analyst disabled 或禁止在该形态启用。

### Phase 1a：文件型 analyst + 只读环境检测 MVP

- 新增设置页“分析环境”**只读检测**：探测当前 carrier 的 managed runtime 与（高级选项下）外部解释器，运行实际 import probe 与版本表。NumPy 与 pandas 为必需能力；PyArrow 作为可选能力一并探测并回报（其数据面在 Phase 2 才用）。只返回状态、版本与下一步，不返回绝对解释器路径或依赖文件内容；不提供任何下载/安装/修复入口，不执行 pip。检测通过即可在受支持形态启用 analyst；不通过则显示 `python_runtime_unavailable` / `python_dependency_unavailable` 并保持 `disabled`。
- 新增 `read_profile`、workspace prepare/finalize、普通 JSON/JSONL/CSV artifact 与派生 Dataset writer；复用 store/session/time helpers，不公开 raw-row 工具返回。
- analyst 的 shell 复用平台 `ctx.shell`/sandbox/approval 通道（不挂 `dsh-bash-local`、不新增 Capital 闸门）；补一条回归：analyst 发起的 bash 报告与同会话其他 bash 相同的 `sandbox.mode`，且 workspace 外写入被拒。
- 实现 run manifest、attempt 快照、result schema、输入/输出哈希、CPU/wall/output/log/磁盘系统预算、派生 lineage 与可恢复错误语义；不设 per-run dataset/count cap，以 brief goal 作为停止条件。
- analyst 根据自身 brief 做 visualization gate，需要时签 `chart_source_ref` 并直接创建 one-shot `visualization_specialist`；调整共享 specialist persona 使其 creator 为受授权 delegated data agent，而非限定 data_junior。
- 按角色流程齐改委派行、persona、skill、主 persona 路由/reuse（含**按需激活**与 §6.2 `analysis_data_request` 补数回路）、`docs/dev/data-roles.md` 与测试；只有注册面、环境检测 UI、DSH 产品形态、图表 scope 均验收后才 enable。

### Phase 1b：受确认的 managed 环境准备/同步（依赖 host seam）

- 前置条件：DSH host 提供受确认的 runtime provisioning API（优先），或产品明确批准 Capital 基于官方锁定 manifest 自建安装器。条件未满足前 1b 不启动，也不对外承诺一键准备。
- 实现检测面板的“准备/修复分析环境”动作：先复用 carrier payload；缺失时按 DSH primary-runtime lock 固定版本的 CPython 与 NumPy/pandas（全市场另加 PyArrow）wheel 安装到 DSH-home 专属 managed 目录。不修改用户 system Python / venv / workspace / npm 包。
- staging 校验平台架构与官方 SHA-256、解释器与必需库 import、`pip check` 与版本 smoke 后原子切换；失败删 staging、保留旧完整环境并可重试。相同 lock/payload 幂等复用，版本更新前提示确认；可选“跟随 DSH runtime 版本自动准备”必须另行 opt-in。分析任务自身绝不安装/更新包。

### Phase 2：Market Dumps 全市场 Parquet 数据面

- `data_collector` 注册 file Dataset/artifact 采集能力：获取一次性签名链接、立即下载、校验 hash/schema/manifest，URL 不入日志/消息；用不可变 artifact 版本记录 dump id/覆盖范围/行数/捕获时间。
- 实现流式文件读写、Parquet footer/schema/profile、10y FULL 基线与 10 交易日增量合并/去重策略、失败重试重签 URL、下载取消/磁盘预算、DatasetRef/lineage/retention 和工具结果小回执。
- 确认兼容 NumPy/pandas 的 Parquet engine（例如 PyArrow）由 DSH runtime manifest 支持并经设置检测；否则新增明确“市场 dump 分析能力不可用”状态，不能让全量文件只下载后无从读取。
- 注册后同步生成的能力目录与巡检/合约测试；全市场数据分析按用户目标筛选/流式计算，停止条件不变。

### Phase 3：按实测证据扩展

- 只有文件型处理出现已测量的查询瓶颈，才另行评估 DuckDB；DB 不作为 analyst 启用前置条件。
- `run_analysis` 如仍有价值，再独立设计受控执行、异步 job 生命周期与数据 API；本文件不授权加入 composition-wide PTC `run_code`。

### 验收矩阵

| 场景 | 预期 |
|---|---|
| Linux bash 与 Windows pwsh | 两端都能创建/编辑/执行 `.py`；shell 名和角色可见性与 preset、guard、deny 相符 |
| Python 不存在 | `python_runtime_unavailable`，无安装尝试、无成功结论 |
| 第三方包不存在 | `python_dependency_unavailable`，点名缺包，不自动 pip/uv 安装 |
| array / envelope rows / document | JSON 均可用；只对行型输出 JSONL；只对平面 scalar 输出可选 CSV；document 不伪造表格 |
| CSV 空值/缺失/类型混合 | 导出明示 lossy 与映射，精确分析仍以 JSONL/JSON 为准 |
| profile 不属于 Dataset 或超期 | 宿主拒绝；不信任模型提供路径或 profile 自述身份 |
| 未授权 session / 根 Agent / 通用 child | 工具层拒绝；不能只靠 persona 限制 |
| 脚本退出非零、超时、输出超限、非法 JSON、NaN/Infinity | 明确失败码；不发布不完整派生 Dataset |
| 运行中 canonical 或 input hash 变化 | 失败并保留诊断；不宣称源不可变已被技术性保障 |
| 派生序列发布 | 新 immutable Dataset；记录 derived_from、task/analysis、方法/参数、脚本与输入哈希 |
| 返回结果过大或含原始 rows | 不进入 Agent 消息；按现有 7000 码点闸门返回小回执，拒绝或收窄 |
| 按需激活 | 事实查询、只需 profile/聚合的任务不创建 analyst；需要逐行/统计/回测的任务才创建或复用 |
| 补数回路 | analyst 的 `analysis_data_request` 经主 Agent 判定范围；范围内取数后发回同一 analyst 续跑，范围外拒绝并说明 |
| 补数后的完整性 | 补数执行记为新 attempt 并记录新增输入哈希；不得用补数前的旧 attempt 结果冒充最终结论 |
| Desktop 根侧 tool restriction 不生效 | 不能因此把 analyst shell 暴露给根角色；analyst 的 bash 必须与同会话其他 bash 走同一条 sandbox/approval 通道 |
| 角色启用回归 | `agentPresets.resolve()` 无 broken、preset inventory active、`npm test` 全绿、`npm run check:dsh` 与平台验收通过 |

## 11. 预期实现触点

这份文档本身不实现功能。后续实现至少会涉及：

- `src/data-collector/store.ts`：profile 受控读取、run 输入读取/写入复用、派生 Dataset lineage、大小/hash/授权检查。
- `src/data-collector/dataset-tools.ts` 或独立 analysis 模块：工具 schema、delegated session、准备/完成流程与稳定错误码。
- `src/index.ts`：通过 `apply()` 注册服务/工具，避免装配期探测外部 Python 造成一次失败后整进程缺能力。
- `preset/capital-generation/agent.patch.yml`：只有工具真实存在后才启用 analyst；角色专属 shell 与通用 child deny 对齐。
- `preset/capital-generation/skills/`、`preset/capital-generation/README.md`、`docs/dev/data-roles.md`、`docs/dev/preset-persona.md`、`AGENTS.md`：协议、角色边界、数据布局和维护索引同步。
- `test/`：profile 读取授权、workspace/run 生命周期、平台 Python 发现、无 Python/缺包、文件格式、hash/lineage、工具输出 schema/lossless JSON、preset/交叉平台/打包测试。
- 如新增宿主能力或依赖，更新 `docs/reference/dsh-surface-ledger.md`、对应探针、`package.json`/发布清单与第三方声明；不得把 Python runtime/包作为本仓依赖加入。

## 12. 未决项

在进入代码实现前还需完成这些可验证事项：

1. **DSH 托管环境 provisioning API（已定：Phase 1a 不依赖）**：官方 runtime 查询工具只消费 carrier payload，不会从零构建/下载。已接受 Phase 1a 为“只检测、不自动准备”：设置页只呈现检测结果与阻塞项，检测通过即按 1a 判据启用、不通过保持 `disabled`，UI 不出现假的“一键准备”。自动准备/同步归 Phase 1b，前置条件是 DSH host 提供受确认的 provisioning API，或另行批准 Capital 自建 pinned-payload 安装器。
2. **NumPy/pandas 兼容矩阵**：固定目标版本/范围、支持的 Python 实现与 ABI。若用户手选外部解释器，提供检测/使用但不自动修改该环境。
3. **Parquet reader**：决定 DSH managed runtime 是否包含并供应 PyArrow（pandas 本身不保证 Parquet reader），以及 Web/Windows/Linux carrier 是否同一依赖集。
4. **Market Dump 获取额度与产品默认**：哪些任务采用 10 年 FULL，哪些只用 daily-k-10d 增量；增加采集前是否需单独向用户确认费用/下载体积（根据 Fuyao 当前配额/价格契约核验）。签名 URL 过期和鉴权错误不得盲目重试。
5. **角色口径接口**：data_junior 提供的 `trading_calendar`、缺失/异常 flags 与交易日年化事实，需在协议中定其机器可读字段。无风险利率源优先验证 ChinaBond 官方人民币国债曲线（短端代理）是否有许可明确、稳定、可重复的结构化接口；Web 页面当前只证明官方曲线与期限/日终发布信息，不证明其可作为插件自动采集 API。无法建立可靠 source 时，把 rate-dependent 输出标为不可计算或按 brief 显式声明情景假设。
6. **总系统资源预算**：不限定任务 Dataset 数/行数；仍需跨平台实测单个文件大小、总磁盘配额、并行 run 数、CPU/内存、日志/result/output 与 wall time。超系统预算要能取消/恢复或 partial，不得静默截断。
7. **Market Dump 增量与不可变 lineage**：确定 daily-k-10d 与 10y FULL 的 artifact 版本关系、重叠日期去重、替换/修复、过期 manifest、保留和物理清理语义。
8. **产品形态验收**：Linux Web、Windows Desktop、headless/SDK（如支持）分别确认 settings、runtime probe、shell 命令/超时/spill 形状、工作目录及 analyst→specialist direct-child token 路径。DSH Bash/Pwsh executor 默认预算已从官方源码查到；未决点是 Capital 实际 carrier 是否挂载这些 executor/settings/jobs 服务及 Desktop 下真实工具可见性，不是等待查询 timeout 定义。
9. **shell 执行边界（已定：遵从 DSH 权限档位，不另设闸门）**：analyst 的 bash 与平台其他 bash 共用 `ctx.shell` → sandbox → approval 通道，档位由用户选定（默认 `workspace-write`：workspace 内可写、出界写被拒、升档需审批）。`workspace-write` 不覆盖读、网络、进程可见性与凭据，这是 DSH 自身声明的策略词汇边界，不由 Capital 补足；需要这些维度隔离时另立容器/VM/远程执行器。Phase 1a 只需验证 analyst 不绕过该通道。

10. **补数轮次的收敛观测（暂不设限）**：不设轮次硬上限；先按 brief 停止条件 + 系统预算运行，收集是否出现“连续 `blocking` 补数仍不收敛 / 重复索要同一缺口”的实测证据，再决定是否需要软闸。

Phase 1a 启用判据（已定）：必需 NumPy/pandas 检测通道、核心工具注册（含 `read_profile`）、analyst 不绕过 DSH sandbox/approval 通道（见 §3.1）和至少一条产品形态端到端验收齐备，即可在检测通过的形态启用 analyst；**不再把“自动准备/同步”作为 1a 的前置条件**。任一形态检测不通过时，该形态显示阻塞项并保持 `disabled`。不通过扩大 allowlist 或 persona 文案提前承诺运行能力；自动准备/同步仍需 Phase 1b 的 host seam。

## 13. 核验来源

### DSH 官方源码（0.2.1-alpha.2，commit `d743267388641bc76f17c45ce8b4c231aed1d32c`）

- Runtime payload query/setup：`packages/skill/tool-workspace-dependencies/src/index.ts`，文档 `packages/skill/tool-workspace-dependencies/README.md`；Desktop runtime carrier：`apps/desktop/README.md`；SDK profile 示例：`packages/profiles/sdk/cordis.patch.yml`。
- Bash/Pwsh executor 默认预算与设置表单能力：`packages/shell/bash-local/README.md`, `packages/shell/pwsh-local/README.md`, `packages/shell/bash-local/src/index.ts`, `packages/shell/pwsh-local/src/index.ts`。
- Model shell foreground/background promotion：`packages/shell/tool-bash/src/index.ts`, `packages/shell/tool-pwsh/src/index.ts`。
- Background job 读取/取消/完成通知：`packages/jobs/tool-jobs/README.md`。本仓当前 preset 的 shell 行仍 `enableRunInBackground: false` 且未挂 jobs。

### 本仓实现

- 普通 JSON Dataset 与 profile：`src/data-collector/store.ts`、`src/data-collector/hub.ts`、`src/data-collector/dataset-tools.ts`。
- shell 与 root gating：`src/agents/bash-guard.ts`, `src/agents/root-tool-policy.ts`, `docs/dev/bash-gate.md`。
- 图表 token / host render：`src/chart/source-token.ts`, `src/chart/tool.ts`。
- 当前 disabled analyst 与 shell/tool rows：`preset/capital-generation/agent.patch.yml`。
- Market Dump 当前未注册状态：`docs/data-collector-capabilities.md`。
- ChinaBond 官方曲线背景与工作日发布节奏：`https://yield.chinabond.com.cn/cbweb-pbc-web`。本页证明数据内容/发布时间，不证明结构化下载 API 或授权，须先完成 source 验收。

### Fuyao 官方 Market Dumps 文档

- `https://fuyao.aicubes.cn/docs/api-reference/market-dumps`：三个 Parquet dump、短时有效预签名 URL 和下载工作流。官方文档未描述异步 job/polling。当前本仓未实现任何 dump 下载或 Parquet 存储/读取。

### 外部候选（§3.4 调研，未引入）

- Kronos 本体：`https://github.com/shiyu-coder/Kronos`（`master`，2026-10-13 核验）；论文 arXiv:2508.02739；权重 `https://huggingface.co/NeoQuasar/Kronos-{mini,small,base}` 与 `Kronos-Tokenizer-base`，四者 cardData 均标 MIT。依赖清单只看 `requirements.txt`（`torch>=2.0.0` 等），finetune 一节自带 non-production disclaimer。
- 反面材料（把模型能力写成 skill 的现成形态，勿照抄）：`https://github.com/RKiding/Awesome-finance-skills`（Apache-2.0，HEAD `853f09b4d`，2026-03-29）。上面那条 `weights_only` / `getctime` / 运行期下载权重的判定取自该仓 `skills/alphaear-predictor/scripts/` 逐行核对，不是引用它的文档措辞。
- Qlib（finetune 示例的取数依赖，非本仓依赖）：`https://github.com/microsoft/qlib`，MIT。
