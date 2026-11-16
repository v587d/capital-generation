# `python-runtime` 设计

> 状态：**实现中**。本文件是 `capital-generation` 插件私有 Python 运行时的实现依据。
>
> 它取代 `data-analyst-architecture.md` 里“项目不打包 Python、等待 DSH host provisioning seam”的旧前提：
> 运行时由插件自己安装、校验和持有，不依赖用户系统 Python，也不依赖 DSH Desktop primary runtime。

## 0. 决策摘要

1. **插件私有**：运行时安装在 `$DSH_HOME/cache/cg/python-runtime/`，只服务本插件；不写入
   `$DSH_HOME/dsh-runtimes/`，不修改系统 Python、全局 `PATH` 或 `PYTHONPATH`。
2. **按需安装**：主 npm 包不携带解释器；用户在设置页点「准备分析环境」或运行 CLI 时，
   才从 npm 安装当前平台的运行时包。主包保持约 5–6 MB。
3. **固定版本**：解释器和每个三方库都精确 pin；运行期不允许 `pip install`，升级只能换新的
   runtime pack。
4. **分层 pack**：`base` 必装（Python + numpy + pandas + 日期/时区依赖）；`parquet` 可选
   （pyarrow）。以后按同样机制增加 `stats`、`excel` 等 pack。
5. **一次性进程**：分析任务一次一个 Python 进程，请求/结果走 run 目录文件；不做常驻 Python
   服务、不占端口、大结果不走 stdio。
6. **明确边界**：插件 spawn 的 Python 不受 DSH workspace sandbox 约束；任意 `analysis.py`
   必须作为独立阶段做角色授权和安全评审，不能因为“运行时已就绪”就默认开放。

## 1. 命名

| 位置 | 名称 |
|---|---|
| Host 行 id | `python-runtime` |
| Cordis 服务 | `pythonRuntime` |
| 源码目录 | `src/python-runtime/` |
| 包导出 | `./python-runtime` |
| HTTP 路由 | `/python-runtime/*` |
| CLI | `scripts/python-runtime.mjs` |
| 设置页 tab 值 / 文案 | `python` / 分析环境 |
| 缓存目录 | `$DSH_HOME/cache/cg/python-runtime/` |
| npm 平台包 | `@v587d/cg-py-base-<target>`、`@v587d/cg-py-parquet-<target>` |

`capital-runtime`（图表共享运行时）保持不变，两者职责不同。

## 2. 版本基线

首期锁定：

```text
Python          3.13.17
numpy           2.4.6
pandas          3.0.6
python-dateutil 2.9.0.post0
six             1.17.0
tzdata          2026.6
pyarrow         25.0.1   # parquet 可选包
```

选择规则：

- Python 取当前稳定版的 N-1 minor（3.13；3.14 太新），支持到 2029；Windows 使用
  python.org 官方 embeddable（PSF 签名），macOS/Linux 使用 python-build-standalone。
- 原生库取 N-1 minor 的最新 patch：成熟度更高，且 cp313 wheel 覆盖 Windows x64、
  macOS arm64/x64、Linux x64。
- `tzdata` 是数据包，取最新；`python-dateutil` 是长期事实标准，暂不跟进 4.x major。
- 所有直接和传递依赖都写入 manifest，probe 逐项校验；不运行 `pip install -U`。

## 3. 平台矩阵

| 平台 | 架构 | 最低要求 | 首期 |
|---|---|---|---|
| Windows | x64 | Windows 10 1809+ | 是 |
| macOS | arm64 | macOS 12+ | 是 |
| macOS | x64 | macOS 12+ | 是 |
| Linux | x64 | glibc 2.28+（含 WSL2 Ubuntu 20.04+） | 是 |
| Linux | arm64 | — | 后续 |
| Windows | arm64 | — | 后续（pyarrow 支持不齐） |
| Alpine/musl | — | — | 不支持，明确报错 |

macOS 12 是 pyarrow 25 的 wheel 下限；base 本身可在 11 上运行，但为了不出现
“base 能装、parquet 不能装”的分裂状态，统一要求 12+。

## 4. 包布局

每个 pack 是普通 npm 包（没有 `dsh.bundle` / `dsh.client`），安装后扁平化为：

```text
<final>/
  ready.json
  payload/
    runtime-pack.json
    python/                 # Windows embeddable 或 POSIX 解释器树
    site-packages/          # 该 pack 的库
```

`runtime-pack.json`：

```json
{
  "schemaVersion": 1,
  "kind": "base",
  "platform": "linux",
  "arch": "x64",
  "pythonVersion": "3.13.17",
  "executable": "python/bin/python3.13",
  "sitePackages": ["site-packages"],
  "packages": {
    "numpy": "2.4.6",
    "pandas": "3.0.6"
  }
}
```

parquet pack 的 `kind` 是 `lib`，`executable` 为 `null`，并带
`"requires": { "base": "1.0.0" }`。解析运行时路径不靠平台分支，靠 pack 自己声明的
`executable` / `sitePackages`。

## 5. 缓存与原子发布

```text
$DSH_HOME/cache/cg/python-runtime/
  base/
    1.0.0/
      win32-x64/
        ready.json
        payload/
  parquet/
    1.0.0/
      win32-x64/
        ready.json
        payload/
  pnpm-store/
  staging/
  locks/
```

- 安装先写 `staging/<pack>-<version>-<target>-<uuid>/`，probe 通过后才 `rename` 到最终目录。
- `ready.json` 只存相对路径；缓存目录整体搬走后仍可用。
- 版本目录并存；默认保留当前和上一版，不自动删旧版本（多个 DSH profile 可能共用缓存）。
- 安装锁是目录锁 + 心跳；进程崩溃后锁会过期，staging 会在下次准备时清理。

`ready.json`：

```json
{
  "schemaVersion": 1,
  "pack": "base",
  "packVersion": "1.0.0",
  "target": "win32-x64",
  "package": "@v587d/cg-py-base-win32-x64",
  "pythonVersion": "3.13.17",
  "packages": { "numpy": "2.4.6", "pandas": "3.0.6" },
  "python": "payload/python/python.exe",
  "sitePackages": ["payload/site-packages"],
  "installedAt": "2026-11-16T00:00:00.000Z",
  "probe": { "ok": true, "at": "2026-11-16T00:00:00.000Z" }
}
```

## 6. 安装流程

1. `status()` 只读：平台、manifest、`ready.json`、文件存在性、已记录大小；不启动 Python。
2. 用户点「准备分析环境」后创建单飞 job。
3. 检查磁盘空间（默认至少 768 MB 空闲）。
4. 在 staging 写 `payload/package.json` 和 `.npmrc`：

```ini
node-linker=hoisted
package-import-method=auto
ignore-scripts=true
strict-peer-dependencies=false
auto-install-peers=false
```

5. 用 pnpm 把精确版本的平台包装进 staging：

```bash
pnpm install \
  --dir <staging>/install \
  --ignore-workspace \
  --no-lockfile \
  --prod \
  --ignore-scripts \
  --store-dir <cache>/pnpm-store \
  --reporter=append-only
```

pnpm 负责 registry、镜像、代理、重试和 tarball integrity；pack 没有 postinstall，不需要
DSH 的 build approval。

6. 把 `node_modules/<pack>` 移到 `staging/payload`，删除 `install/`，缩短 Windows 路径。
7. 校验 `runtime-pack.json`：平台/架构/Python/packages/相对路径；拒绝符号链接逃逸。
8. POSIX 上给解释器补 `0o755`；Windows 不需要。
9. 用包内 Python 跑 probe：解释器 realpath 必须在 payload 内，numpy/pandas 版本必须精确匹配，
   最小 DataFrame 运算必须成功；parquet pack 额外做一次 Parquet 读写。
10. 写 `ready.json`，原子 rename 到最终目录；失败则删除 staging，旧环境不动。

实现注意：

- pbs 的 `python/.gitignore` 内容是 `*`；npm pack 会据此把整个 `python/` 排除。打包前必须删除该文件。
- pnpm 11 在 `--dir` 指向另一个项目时可能忽略项目 `.npmrc` 的 `node-linker`；安装命令显式带
  `--config.node-linker=hoisted`，否则 `node_modules/<pkg>` 是符号链接，flatten 后会断。
- Windows 路径长度靠“安装后把 `node_modules/<pkg>` 移成 `payload/`”缩短；打包时裁掉 tests/include。
- `runtime-pack.json` 必须和 manifest 的 Python/库版本逐项一致；probe 失败不发布。

## 7. 运行流程

首期只提供运行时准备与 probe；`run_analysis` 是下一阶段。

将来的运行目录：

```text
capital-analysis/runs/<run_id>/
  analysis.py
  request.json       # 数据集路径与参数，不是原始 rows
  outputs/
  logs/stdout.txt
  logs/stderr.txt
  result.json
  run.json
```

启动：

```bash
<python> -I -B -u python/worker.py \
  --run-dir <run_dir> \
  --site-packages <base>/site-packages \
  --site-packages <parquet>/site-packages
```

约束：

- `cwd` 是 run 目录；run 目录加入 `sys.path[0]`，允许同目录 helper 模块。
- stdout/stderr 直接进日志文件，不参与控制协议。
- 结果写 `result.json`，只含小摘要和产物引用；大结果留在 `outputs/`。
- 默认超时 300 秒；stdout/stderr 各 1 MB；结果 1 MB；summary 8 KB。
- 同时最多 1 个分析进程，避免 pandas 内存叠加。

## 8. 隔离与安全

必做：

- 只用缓存内绝对路径解释器，不用 `python` / `python3` 命令名。
- `-I -B -u`；Windows embeddable 依赖 `_pth`，M0 要验证 `-I` 与 `_pth` 组合。
- 清洗 Python 子进程环境：删除 `PYTHONPATH`、`PYTHONHOME`、`PIP_*`、`LD_*`、`DYLD_*`；
  `HOME`/`USERPROFILE`/`TMPDIR` 指向 run 目录；`PATH` 最前放私有 Python 目录。
- pnpm 子进程保留代理、CA、npm registry 配置；不把 DSH 凭据放进 Python 环境。
- 进程组 kill：POSIX 用 `detached` + `kill(-pid)`；Windows 用 `taskkill /T /F`。
- `dispose()` 杀掉自己的子进程；不按 `python.exe` 名字杀。
- pack 不含 `pip`、`ensurepip`、`venv`；运行期不允许装包。

明确不做的：

- 不把 Python 层 guard 当安全边界；它不是 OS sandbox。
- 不在分析回合偷偷下载/升级运行时。
- 不把 API key 放进 Python 环境；数据由 DSH 侧预取。
- 不开放任意 `analysis.py`，直到 `run_analysis` 有角色授权、脚本路径校验、超时和产物上限。

## 9. 错误码

| code | 含义 |
|---|---|
| `unsupported-platform` | 平台/架构/libc/macOS 版本不在矩阵内 |
| `manifest-invalid` | manifest 读不到或字段不合法 |
| `runtime-not-ready` | 用户还没准备运行时 |
| `runtime-locked` | 另一个进程正在安装 |
| `pnpm-missing` | 找不到 pnpm/CLI |
| `network` | registry 不可达或代理失败 |
| `not-found` | 运行时包版本不存在/镜像未同步 |
| `disk-space` | 空闲空间不足 |
| `permission` | 缓存目录不可写/不可执行 |
| `probe-failed` | 解释器或库自检失败 |
| `timeout` | 安装/probe/分析超时 |
| `cancelled` | 用户取消 |
| `pack-invalid` | `runtime-pack.json` 与 manifest 不一致 |

## 10. 验收

- 干净 Windows/macOS/Linux（含 WSL2 Ubuntu）无需用户安装 Python；设置页/CLI 能准备 base。
- `sys.executable` 在缓存内；系统 Python 与 DSH primary runtime 未被修改。
- 毒化 `PYTHONPATH`/`PYTHONHOME`/`PIP_*`/`LD_*`/`DYLD_*` 后仍只从 pack 导入。
- 路径含空格/中文可运行；macOS 12+、Windows 10+、glibc 2.28+。
- 并发 prepare 只装一次；安装中 kill 后可重试，旧环境仍可用。
- pack 缺文件时 status 变 broken，修复可重装；缓存搬目录后 probe 仍通过。
- 主包 `npm pack` 仍约 5–6 MB；base/parquet 单独发布，各自低于 npm 实际大小限制。
- `THIRD_PARTY_NOTICES.md` 覆盖 Python、numpy、pandas、pyarrow、pbs 及其原生依赖。

## 11. 实施阶段

| 阶段 | 内容 |
|---|---|
| M0 | Linux pack + pnpm 本地 tarball 安装 + flatten + probe + worker |
| M1 | `src/python-runtime/`、CLI、锁、原子发布、错误码 |
| M2 | Windows/macOS/Linux CI 平台包与 probe |
| M3 | `python-runtime` host 行、路由、设置页「分析环境」 |
| M4 | parquet pack 与按需安装 |
| M5 | `run_analysis` 安全评审与角色授权 |

首期实现范围：M0–M4 的运行时链路；`data_analyst` 继续 `disabled`，不因为运行时存在而启用。

## 12. 当前落点（2026-11-16）

已落地：

- `runtime/manifest.json`：版本、平台目标、包名、体积与限制。
- `runtime-build/`：
  - `pack.mjs`：npm 元数据、`runtime-pack.json`、许可文本、符号链接逃逸检查、`npm pack`。
  - `build-posix.sh` / `build-linux.sh` / `build-macos.sh`：Linux x64、macOS arm64/x64。
  - `build-windows.ps1`：python.org 官方 embeddable + uv 安装 wheel。
  - `verify-pack.mjs`：真实 manager 安装 + worker `run` + pandas/时区/Parquet 回环。
- `.github/workflows/python-runtime-packs.yml`：四目标原生构建、安装验证、tag 发布；
  发布走 npm Trusted Publishing（OIDC），tag 为 `python-runtime-v<version>`。
- `src/python-runtime/`：平台判定、manifest、路径/锁、pnpm、probe、manager、HTTP 路由；
  `verify --pack parquet` 会一并校验 pyarrow。
- `python/worker.py`：`probe` / `run` 两个入口，纯标准库，显式 `--site-packages`。
- `scripts/python-runtime.mjs`：status / prepare / verify / remove / import。
- `src/python-runtime-entry.ts` + `cordis.patch.yml` 的 `python-runtime` host 行。
- 设置页第五格「分析环境」：只读状态、准备/修复/取消/移除、Parquet 可选安装。
- WSL 实测：本地 base/parquet tarball → pnpm → flatten → probe → worker → 缓存搬运后仍可运行。

实测体积（Linux x64，2026-11-16）：base `53.6 MB` tgz / `162.7 MB` 解压；
parquet `49.9 MB` tgz / `154.7 MB` 解压。

CI 原生验证（PR #18，run 43811721333）：`darwin-arm64` 55s、`linux-x64` 1m3s、
`win32-x64` 1m40s、`darwin-x64` 2m11s 全部通过。每个平台都走完整链路：
tarball → manager `prepare` → `verify --pack parquet` → worker `run` +
pandas/时区/Parquet 回环。本地没有 Windows/macOS 真机，这一步以 CI 为准。

**1.0.0 已发布（2026-11-16）**：`python-runtime-v1.0.0` tag 的 publish job 用 OIDC +
provenance 发布八个包；`latest` 指向 `1.0.0`，`bootstrap` tag 保留 `0.0.0` 占位包。
在 Linux x64 干净 DSH home 上从 registry（不带 `--tarball`）实测 `prepare base` →
`prepare parquet` → `verify --pack parquet` → worker/Parquet 回环全部通过。

待办：

- `run_analysis` 的角色授权、脚本路径校验、产物上限（M5）。
- AGENTS 索引（待 AGENTS 体积闸门腾出空间后补；当前以本文件作为运行时实现依据）。
