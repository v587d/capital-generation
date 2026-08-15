"""数据湖 CLI 薄封装 — THS 官方 marketdb (subprocess 集成, v0.3.0 M1/M2).

用户裁定 (2026-08-15): 数据湖 = 纯离线数据资产, 不进 LLM (无 MCP 工具)。
本脚本是数据湖的唯一入口: 下载 (auto-sync/update-daily)、质量 (validate)、
修复 (rebuild-views/rebuild-factors)、查询 (query/describe/status/export)。

集成事实 (M0 核实, 2026-08-15):
- 官方仓库 HiThink-Tech/Financial-API (MIT), marketdb 包 `pip install -e ./python`
  (python/toolkit/marketdb/README.md; 不在 PyPI, 从官方克隆安装)。
- key 规范名 `HITHINK_FINANCE_API_KEY` (credentials.py); 本仓库 THS key 同值直通。
- 四层表 raw/calc/dim/stg + _meta(schema_version) + _import_batches(审计);
  validate 8 项质量校验; rebuild 只重建视图/因子, 禁删 raw (导入器内部 upsert)。
- 复权: backward_factor 累乘 / forward_factor = backward / last (前复权最新对齐真实)。
- **官方 marketdb 无 data.lock** (LESSONS §3.4 的锁来自 pi-fin-prism 参考) →
  并发纪律由本 wrapper 的 flock 保证 (同库串行)。
- 下载: dump provider 内置 presigned URL 过期重取 + Range 断点续传 (200/206)。

用法:
    HITHINK_FINANCE_API_KEY=<ths_key> uv run python scripts/lake.py sync [--db PATH]
    uv run python scripts/lake.py validate [--db PATH] [--json]
    uv run python scripts/lake.py rebuild [--db PATH]
    uv run python scripts/lake.py status|describe [--db PATH] [--json]
    uv run python scripts/lake.py query --sql "SELECT ..." [--limit 100] [--db PATH]
    uv run python scripts/lake.py import-parquet --daily F --events F [--db PATH]
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO / "dumps" / "market.duckdb"
DEFAULT_CACHE = REPO / "dumps" / "dump-cache"  # MARKETDB_DUMP_CACHE_DIR (Parquet 缓存, gitignored)


def _db_path(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    env = os.environ.get("MARKETDB_DB_PATH", "").strip()
    return Path(env) if env else DEFAULT_DB


def _api_key() -> str | None:
    """HITHINK_FINANCE_API_KEY → THS_API_KEY (同值直通, BYOK; 缺失则仅离线子命令可用)."""
    return os.environ.get("HITHINK_FINANCE_API_KEY") or os.environ.get("THS_API_KEY")


def run(
    args: list[str],
    *,
    db: Path,
    api_key: str | None = None,
    capture: bool = True,
) -> subprocess.CompletedProcess[str]:
    """marketdb CLI 调用 — 同 venv (sys.executable), 库级 flock 串行, 完整错误上下文."""
    cmd = [sys.executable, "-m", "marketdb.cli", *args, "--db", str(db)]
    env = {**os.environ}
    if api_key:
        env["HITHINK_FINANCE_API_KEY"] = api_key
    env.setdefault("MARKETDB_DUMP_CACHE_DIR", str(DEFAULT_CACHE))

    lock_path = db.with_suffix(db.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # data.lock 语义: 同库排他 (官方 marketdb 无内置锁)
        try:
            return subprocess.run(cmd, env=env, capture_output=capture, text=True, timeout=3600)
        except subprocess.TimeoutExpired as e:
            raise RuntimeError(f"marketdb {' '.join(args)} 超时 (3600s): {e}") from e
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _finish(proc: subprocess.CompletedProcess[str], label: str) -> int:
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[-500:]
        print(f"❌ marketdb {label} 失败 (exit={proc.returncode}): {err}", file=sys.stderr)
        return proc.returncode
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    """全量/增量自动判断 (auto-sync): 落后太久或首次 → 全量 dump, 否则 REST/增量."""
    key = _api_key()
    if not key:
        print("sync 需要 THS key: HITHINK_FINANCE_API_KEY 或 THS_API_KEY", file=sys.stderr)
        return 2
    proc = run(["auto-sync"], db=_db_path(args.db), api_key=key)
    return _finish(proc, "auto-sync")


def cmd_update(args: argparse.Namespace) -> int:
    """增量: 补最近交易日 (REST, 不打全量 dump)."""
    key = _api_key()
    if not key:
        print("update-daily 需要 THS key", file=sys.stderr)
        return 2
    proc = run(["update-daily"], db=_db_path(args.db), api_key=key)
    return _finish(proc, "update-daily")


def cmd_validate(args: argparse.Namespace) -> int:
    """8 项质量校验; error 级问题 → 退出码 1 (可观测, 不自动修复)."""
    proc = run(["validate", "--json"], db=_db_path(args.db))
    if proc.returncode != 0:
        print(
            f"❌ validate 失败 (exit={proc.returncode}): {proc.stderr.strip()[-300:]}",
            file=sys.stderr,
        )
        return proc.returncode
    data = json.loads(proc.stdout)
    if args.json:
        sys.stdout.write(proc.stdout)
    else:
        ok = data.get("ok")
        print(f"validate: {'✅ ok' if ok else '❌ issues'} ({data.get('db_path')})")
        for issue in data.get("issues", []):
            print(f"  [{issue['severity']}] {issue['check']}: {issue.get('detail', '')[:120]}")
    return 0 if data.get("ok") else 1


def cmd_rebuild(args: argparse.Namespace) -> int:
    """修复语义: 只重建视图与因子 (validate 诊断后的修复手段), 禁删 raw."""
    for sub in ("rebuild-views", "rebuild-factors"):
        proc = run([sub], db=_db_path(args.db))
        rc = _finish(proc, sub)
        if rc != 0:
            return rc
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    proc = run(["status", "--json"], db=_db_path(args.db))
    if proc.returncode != 0:
        return _finish(proc, "status")
    data = json.loads(proc.stdout)
    if args.json:
        sys.stdout.write(proc.stdout)
    else:
        for k, v in data.items():
            print(f"{k}: {v}")
    return 0


def cmd_describe(args: argparse.Namespace) -> int:
    proc = run(["describe"], db=_db_path(args.db))
    return _finish(proc, "describe")


def cmd_query(args: argparse.Namespace) -> int:
    if not args.sql:
        print("query 需要 --sql", file=sys.stderr)
        return 2
    proc = run(
        [
            "query",
            "--json",
            "--sql",
            args.sql,
            *(f"--limit {args.limit}".split() if args.limit else []),
        ],
        db=_db_path(args.db),
    )
    if proc.returncode != 0:
        return _finish(proc, "query")
    if args.json:
        sys.stdout.write(proc.stdout)
    else:
        data = json.loads(proc.stdout)
        print(f"row_count={data.get('row_count')} (truncated_to={data.get('truncated_to')})")
        cols = data.get("columns", [])
        print(" | ".join(cols))
        for row in data.get("rows", []):
            print(" | ".join(str(row.get(c, "")) for c in cols))
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    """离线导入本地 Parquet (合成样本测试/人工 dump 文件; 需符合官方 raw schema)."""
    if not args.daily:
        print("import-parquet 需要 --daily (events 可选)", file=sys.stderr)
        return 2
    argv = ["import-parquet", "--daily", args.daily]
    if args.events:
        argv += ["--events", args.events]
    proc = run(argv, db=_db_path(args.db))
    return _finish(proc, "import-parquet")


def main() -> int:
    ap = argparse.ArgumentParser(description="数据湖 CLI (marketdb 薄封装, 离线资产)")
    ap.add_argument("--db", default=None, help="DuckDB 路径 (默认 dumps/market.duckdb)")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sync", help="全量/增量同步 (需 THS key)")
    p.set_defaults(fn=cmd_sync)
    p = sub.add_parser("update", help="增量补最近交易日 (需 THS key)")
    p.set_defaults(fn=cmd_update)
    p = sub.add_parser("validate", help="8 项质量校验")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("rebuild", help="重建视图与因子 (禁删 raw)")
    p.set_defaults(fn=cmd_rebuild)
    p = sub.add_parser("status", help="库状态 (schema_version/行数/最大日期)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("describe", help="schema 描述 (JSON)")
    p.set_defaults(fn=cmd_describe)
    p = sub.add_parser("query", help="只读 SQL 查询")
    p.add_argument("--sql", required=True)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_query)
    p = sub.add_parser("import-parquet", help="离线导入本地 Parquet")
    p.add_argument("--daily", required=True)
    p.add_argument("--events", default=None)
    p.set_defaults(fn=cmd_import)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
