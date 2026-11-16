"""Private Python runtime worker.

Subcommands:
  probe  Print one JSON line describing the interpreter and imported libraries.
  run    Execute <run-dir>/analysis.py with the private interpreter.

This file uses the standard library only. Third-party imports are resolved from the
explicit --site-packages paths supplied by the host; no pip/venv is involved.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import runpy
import sys
import time
import traceback


def add_site_packages(paths: list[str]) -> None:
    for raw in reversed(paths):
        path = str(Path(raw).resolve())
        if path not in sys.path:
            sys.path.insert(0, path)


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def probe(site_packages: list[str]) -> dict:
    add_site_packages(site_packages)
    import numpy  # noqa: F401
    import pandas  # noqa: F401

    packages = {
        "numpy": package_version("numpy"),
        "pandas": package_version("pandas"),
        "python-dateutil": package_version("python-dateutil"),
        "six": package_version("six"),
        "tzdata": package_version("tzdata"),
    }
    try:
        import pyarrow  # noqa: F401
        packages["pyarrow"] = package_version("pyarrow")
    except ImportError:
        pass

    return {
        "pythonVersion": platform.python_version(),
        "executable": str(Path(sys.executable).resolve()),
        "platform": sys.platform,
        "arch": platform.machine(),
        "sitePackages": [str(Path(item).resolve()) for item in site_packages],
        "packages": packages,
    }


def inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def run(run_dir: Path) -> int:
    run_dir = run_dir.resolve()
    started = time.time()
    request_path = run_dir / "request.json"
    result_path = run_dir / "result.json"
    result: dict = {
        "ok": False,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "python": platform.python_version(),
    }
    try:
        request = json.loads(request_path.read_text(encoding="utf-8")) if request_path.exists() else {}
        script_name = request.get("script", "analysis.py")
        if not isinstance(script_name, str):
            raise ValueError("request.script must be a string")
        script = (run_dir / script_name).resolve()
        if not inside(run_dir, script):
            raise ValueError("request.script escapes the run directory")
        if not script.is_file():
            raise FileNotFoundError(f"analysis script not found: {script}")
        args = request.get("args", [])
        if not isinstance(args, list) or any(not isinstance(item, str) for item in args):
            raise ValueError("request.args must be a string array")

        os.chdir(run_dir)
        sys.path.insert(0, str(run_dir))
        sys.argv = [str(script), *args]
        runpy.run_path(str(script), run_name="__main__")
        result = {
            **result,
            "ok": True,
            "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
        }
        return 0
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else 0
        result = {
            **result,
            "ok": code == 0,
            "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
            **({} if code == 0 else {"error": {"code": "SYSTEM_EXIT", "message": f"analysis.py exited with {code}"}}),
        }
        return code
    except BaseException as error:  # noqa: BLE001 - the wrapper must report any script failure
        result = {
            **result,
            "error": {
                "code": "ANALYSIS_ERROR",
                "type": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc()[-8192:],
            },
            "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
        }
        return 1
    finally:
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("probe", "run"))
    parser.add_argument("--site-packages", action="append", default=[])
    parser.add_argument("--run-dir", type=Path)
    args = parser.parse_args()

    if args.command == "probe":
        print(json.dumps(probe(args.site_packages), ensure_ascii=False, separators=(",", ":")))
        return 0

    if args.run_dir is None:
        parser.error("run requires --run-dir")
    add_site_packages(args.site_packages)
    return run(args.run_dir)


if __name__ == "__main__":
    raise SystemExit(main())
