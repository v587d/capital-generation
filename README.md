# Capital Generation

Capital Generation（Capital 模式）是面向中国股市散户的投资助手，包括 Agent Preset 、专用 subagent 、 可插拔 subagent 和 可插拔 Tools。

> **架构文档**：官方 vs 自研的完整划分、源码出处与 Mermaid 图见
> [`ARCHITECTURE.md`](./ARCHITECTURE.md)；实现契约与避坑清单见 [`SPEC.md`](./SPEC.md)。

当前仓库已按 DSH `0.1.2-rc.1` 拆分为两层：

- `src/`：普通 Cordis 插件包，提供共享数据 Hub（`dataCollectorHub`）、数据工具与
  可选附加人设节（`customPersona`，独立 section 名 `capital:user-customization`，
  不占用官方 `deployment:persona`）。
> DSH 系统提示词由多节（section）组成 = 官方基础节（preset已覆盖） + 自定义人设节 + 其他节

- `preset/capital-generation/`：DSH Agent Preset，承载全部提示文本与工具行——
  Capital 主控人设（`@deepseek-ai/dsh-persona` 行）、data_collector 专用委派行
  （`subagent_data_collector`，由 `config.persona`/`config.toolFilter` 注入子
  Agent 组成）、澄清、任务规划、子代理和网页检索工具行。

当前 `dataCollectorHub` 已接入 Fuyao REST 数据源的 Phase 1 能力：标的检索、行情快照、历史日 K 线和交易日历；并已注册 `request_data`（阻塞等待执行完成）、`get_latest`、`list_schemas`（另有诊断工具 `dc_status`）。配置 `FUYAO_API_KEY`（优先使用 DSH credentials，环境变量作为回退）后才会注册这些数据源。

时间能力（主 Agent 与所有子 Agent 共享）仅来自自研工具 `get_local_datetime`（本地时区/当前日期时间权威读数，支持 `timezone` 参数跨区换算）；不使用官方 per-step `time-context` 自动注入（每个 step 注入一行时钟读数，信息冗余，已从 preset 移除）。主/子人设均已强调「模型知识截止日期不是当前时间，用户未指定日期时间时优先调用 `get_local_datetime`」。

数据源 Tool 必须保持在 Capital 会话/preset 的作用域内，不要把 Fuyao MCP Tools 直接注册到 Host 全局 ToolRuntime；否则可能与 `subagent`、`send_message` 等官方 subagent Tools 发生名称冲突或改变其他 Agent 的可见 Tool 集合。后续 MCP 接入应使用会话范围的 scoped registration，并为 MCP 公共名称保留明确的命名空间。

## 本地构建

```bash
npm install
npm run build
npm test
npm pack --dry-run
```

`npm pack --dry-run` 应包含以下运行时文件：

```text
lib/index.js
lib/index.d.ts
preset/capital-generation/agent.cordis.yml
preset/capital-generation/preset.yml
cordis.patch.yml
```

## 安装到 DSH Web Profile

当前 DSH 0.1.2-rc.1 这一代使用 profile bundle 机制。只需执行一次：

```bash
dsh plugin --profile web add @v587d/capital-generation
```

开发模式也可以直接安装本地目录（改 preset/源码后**重启 profile 进程即生效**，无需重装）：

```bash
dsh plugin --profile web add link:/absolute/path/to/capital-generation
```

包内的 `dsh.bundle` 声明会让安装命令自动把它加入 profile 的 bundle 层；
`cordis.patch.yml` 会将包内的 `preset/` 目录作为只读 system root 注册到现有
`agent-presets` roster。因此不再需要手动 `mkdir`、`cp`，也不需要修改
`~/.dsh/.agent-presets`。
> roster = 花名册 / 注册表 / 名单，管理所有 preset 的目录服务。DSH 中默认roster 已有四种（minimal / standard等）。本项目新增 `capital-generation`

安装后重启 Web profile，在 GUI 新建会话并在 Agent Preset 选择器中选择
`Capital 模式`。安装包默认不覆盖用户已经设置的默认 preset；若希望新会话
默认使用它，可在设置中把 `agent-presets.default` 改为 `capital-generation`。

若 pnpm 提示构建脚本被拦截，将它打印出的包名加入
`~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 列表后重跑安装。

## Capital 模式的提示文本与子 Agent 组成

- 主控人设是 preset 的 `@deepseek-ai/dsh-persona` 行（`deployment:persona` 节，
  官方 `{{model}}`/`{{cwd}}` 变量可用）；插件的 `customPersona` 配置只追加一个
  独立 section（`capital:user-customization`，order 100），不占用 persona 节名，
  因此 `agent.cordis.yml` 中**必须**保留 `@deepseek-ai/dsh-persona` 行。
- `data_collector` 由 preset 的 `subagent_data_collector` 专用委派行创建
  （`@deepseek-ai/dsh-tool-subagent`，`backgroundMode: continuable`）：
  - `config.persona` 承载 data_collector 人设模板——官方 dsh-subagent 创建子
    Agent 时以 `deployment:persona` 节注册到子 Agent 作用域（最近 scope 胜出），
    主 Agent 创建时**不需要复制任何模板**，prompt 只写委托上下文。
> 子 Agent 看不到主 Agent 的人设（最近scope胜出），主 Agent 委派子 Agent任务时，无需告诉对方的人设。

  - `config.toolFilter.allow` 把子 Agent 的可见工具收敛为：官方 `send_message`
    与数据工具（`request_data`/`get_latest`/`list_schemas`/
    `dc_status`）。子 Agent 是叶子执行器，不委派、不问用户、不访问网页/文件。
> `tools.ts` -> `ctx.get('tools')` 获取当前作用域的工具注册服务。这里`ctx`是`capitail-generation-scope`这个被隔离的作用域内的上下文。

## 编排与消息机制（详见 SPEC 与 ARCHITECTURE.md）

- 消息图 = Agent 树：DSH 官方 `sendMessage` 只允许相邻两层通信（直接父/直接
  continuable 子），跨层必须沿树逐层中继；每个 continuable 子 Agent 有且
  只有一个直接 parent。
- 通信原语只有官方 `send_message`：请求 = 父 → 子的一条消息，回传 = 子 →
  父的一条消息；官方 Inbox 负责持久化、唤醒（结算通知自动唤醒父 Agent）与
  cold resume。**没有自定义广播协议、没有 request_id、没有订阅、没有状态轮询。**
- `data_collector` 是主 Agent 的 continuable 子 Agent、数据执行器：主 Agent 用
  `subagent_data_collector` 工具创建（persona/工具集由 preset 配置注入，见上）；
  数据请求经 `send_message` 委派给它；它自己调用 `request_data`（阻塞等待执行
  完成：缓存命中立即返回、执行超时或失败报错），用 `send_message` 把结构化
  回传发给主 Agent。请求归属恒为调用者自身（官方 `exec.agent` 注入），工具层没有
  requester_agent_id 概念。
- 多点消费不依赖血缘：数据和缓存都在共享 Hub（dataCollectorHub），任何
  Agent 都能用只读的 `get_latest`/`list_schemas` 读共享缓存；写路径
  （`request_data`）经 data_collector 统一入口，保证单一数据执行点与缓存纪律。
- 子 Agent 完成 → 官方结算通知/send_message 自动唤醒主 Agent（新 turn）；
  主 Agent 逐条核对委托清单后综合回复用户，不提前断言子 Agent 已完成。
- 启动流程对齐官方：「创建」= 直接调用 `subagent_data_collector`（背景默认），
  返回 durable `subagentId` 由主 Agent 记住；**不要求创建前先查 `list_agents`**。
  `list_agents` 是回忆工具（官方描述：recall, not poll），会话恢复后不确定时
  才用；`running/idle/ready` 三态中 `ready` 目标 send_message 会自动冷恢复，
  因此恢复会话首查可能非空，「必返回为空」不是可依赖的断言。
- 数据源契约：DSH credentials 或环境变量注入 `FUYAO_API_KEY`（credentials 优先），未配置时
  数据源不注册（`dc_status` 可查：凭据解析、已注册源、最近注册错误）。

## 避坑清单（本项目的失败经验，详见 SPEC §12）

1. **别自研消息层**：官方 send_message/Inbox/结算通知已覆盖广播、订阅、唤醒；
   自研 Hub 通知链路约 700 行代码最终全部删除。
2. **工具层别做邻接权限**：请求归属只取官方 `exec.agent.id`；权限校验是官方
   服务层的事，且不要依赖 `parentId`/`directAgentIds` 这类**不存在的 Agent 字段**。
3. **persona 纪律不是权限**：工具可见性 ≠ 权限隔离；边界用官方原语 + toolFilter。
4. **人设别写进插件代码、别占用 `deployment:persona` 节名**：放 preset 声明式行。
5. **别让模型复制长模板创建子 Agent**：用委派工具行的 `config.persona` 注入。
6. **list_agents 是回忆工具，不是创建前检查**：恢复会话首查可能非空（ready）。
7. **测试要面向官方契约**，不要用自己拼的 fake exec/字段自证。
8. **仓库卫生**：git + .gitignore（`lib/`、`node_modules/`、`*.Zone.Identifier`）。

## 当前安全边界

- 自定义 persona 仅影响表达风格与呈现；运行时限制其长度，并在其后追加不可覆盖的安全提醒。
- 当前不索取或保存账户密码、API key、验证码等凭据。
- 当前不输出未经实际模型或回测支持的胜率、概率或收益承诺。
- 当前不提供自动下单能力。