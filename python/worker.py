"""Private Python runtime worker.

Subcommands:
  probe     Print one JSON line describing the interpreter and imported libraries.
  run       Execute <run-dir>/analysis.py with the private interpreter.
  analysis  Import one reviewed analysis module and call analyze(request, context).

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
import re
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


def analysis(
    run_dir: Path,
    module_dir: Path,
    entrypoint: str,
    inputs_dir: Path,
    capabilities: list[str],
    limits: dict,
) -> int:
    """Run one module from the reviewed registry and write <run-dir>/result.json.

    The module only ever sees `analyze(request, context)`; the context is the entire execution surface
    (staged inputs, output files, a log). It is not a sandbox — the real control is that modules ship
    with the package and are reviewed, and that the registry is a static whitelist.
    """
    import importlib.util

    run_dir = run_dir.resolve()
    module_dir = module_dir.resolve()
    inputs_dir = inputs_dir.resolve()
    started = time.time()
    result_path = run_dir / "result.json"
    max_output_bytes = int(limits.get("max_output_bytes", 1048576))
    max_log_bytes = int(limits.get("max_log_bytes", 65536))
    max_input_rows = int(limits.get("max_input_rows", 200000))
    outputs_dir = run_dir / "outputs"
    logs_dir = run_dir / "logs"
    log_path = logs_dir / "module.log"
    log_truncated = False

    def write_result(payload: dict) -> None:
        result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    def log_line(message: object) -> None:
        nonlocal log_truncated
        logs_dir.mkdir(parents=True, exist_ok=True)
        text = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
        line = f"{message}\n"
        if len((text + line).encode("utf-8")) > max_log_bytes:
            log_truncated = True
            return
        log_path.write_text(text + line, encoding="utf-8")

    class Context:
        def read_dataset(self, dataset_id: str) -> dict:
            if "dataset.read" not in capabilities:
                raise PermissionError(f"module did not declare dataset.read (dataset {dataset_id})")
            path = inputs_dir / "datasets" / f"{dataset_id}.json"
            if not inside(inputs_dir, path) or not path.is_file():
                raise FileNotFoundError(f"dataset {dataset_id} is not staged in this snapshot")
            view = json.loads(path.read_text(encoding="utf-8"))
            rows = view.get("rows") or []
            if len(rows) > max_input_rows:
                view["rows"] = rows[:max_input_rows]
                view["truncated"] = True
            return view

        def read_profile(self, profile_id: str) -> dict:
            if "profile.read" not in capabilities:
                raise PermissionError(f"module did not declare profile.read (profile {profile_id})")
            path = inputs_dir / "profiles" / f"{profile_id}.json"
            if not inside(inputs_dir, path) or not path.is_file():
                raise FileNotFoundError(f"profile {profile_id} is not staged in this snapshot")
            return json.loads(path.read_text(encoding="utf-8"))

        def read_evidence(self, evidence_id: str) -> dict:
            if "evidence.read" not in capabilities:
                raise PermissionError(f"module did not declare evidence.read (evidence {evidence_id})")
            path = inputs_dir / "evidence" / f"{evidence_id}.json"
            if not inside(inputs_dir, path) or not path.is_file():
                raise FileNotFoundError(f"evidence {evidence_id} is not in this snapshot")
            return json.loads(path.read_text(encoding="utf-8"))

        def write_output(self, name: str, value: object) -> str:
            if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", name):
                raise ValueError(f"output name is invalid: {name!r}")
            payload = json.dumps(value, ensure_ascii=False, allow_nan=False)
            if len(payload.encode("utf-8")) > max_output_bytes:
                raise ValueError(f"output {name} exceeds max_output_bytes ({max_output_bytes})")
            outputs_dir.mkdir(parents=True, exist_ok=True)
            (outputs_dir / f"{name}.json").write_text(payload + "\n", encoding="utf-8")
            return f"output:{name}"

        def log(self, message: object) -> None:
            log_line(message)

    try:
        request = json.loads((run_dir / "request.json").read_text(encoding="utf-8"))
        module_path = (module_dir / entrypoint).resolve()
        if not inside(module_dir, module_path) or not module_path.is_file():
            raise FileNotFoundError(f"module entrypoint not found: {module_path}")
        spec = importlib.util.spec_from_file_location("capital_analysis_module", module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot import {module_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        analyze = getattr(module, "analyze", None)
        if not callable(analyze):
            raise TypeError("module.py must define analyze(request, context)")
        returned = analyze(request, Context())
        if not isinstance(returned, dict):
            raise TypeError(f"analyze() must return a dict, got {type(returned).__name__}")
        write_result({
            "ok": True,
            "python": platform.python_version(),
            "durationMs": int((time.time() - started) * 1000),
            "logTruncated": log_truncated,
            "result": returned,
        })
        return 0
    except BaseException as error:  # noqa: BLE001 - the wrapper must report any module failure
        # A reviewed module may declare a stable protocol code on its exception; anything else is a
        # module crash and must not be able to impersonate an analysis error code.
        declared = getattr(error, "analysis_code", None)
        failure = {
            "code": declared if isinstance(declared, str) and declared.startswith("analysis_") else "MODULE_ERROR",
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc()[-8192:],
        }
        try:
            write_result({
                "ok": False,
                "python": platform.python_version(),
                "durationMs": int((time.time() - started) * 1000),
                "error": failure,
            })
        except BaseException:  # noqa: BLE001 - a NaN in the result must still leave a report
            result_path.write_text(json.dumps({"ok": False, "error": failure}, ensure_ascii=False) + "\n", encoding="utf-8")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("probe", "run", "analysis"))
    parser.add_argument("--site-packages", action="append", default=[])
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--module-dir", type=Path)
    parser.add_argument("--inputs-dir", type=Path)
    parser.add_argument("--entrypoint", default="module.py")
    parser.add_argument("--capabilities", default="")
    parser.add_argument("--limits", default="{}")
    args = parser.parse_args()

    if args.command == "probe":
        print(json.dumps(probe(args.site_packages), ensure_ascii=False, separators=(",", ":")))
        return 0

    if args.run_dir is None:
        parser.error(f"{args.command} requires --run-dir")
    add_site_packages(args.site_packages)
    if args.command == "run":
        return run(args.run_dir)
    if args.module_dir is None or args.inputs_dir is None:
        parser.error("analysis requires --module-dir and --inputs-dir")
    try:
        limits = json.loads(args.limits)
    except json.JSONDecodeError as error:
        parser.error(f"--limits is not valid JSON: {error}")
    capabilities = [item for item in args.capabilities.split(",") if item]
    return analysis(args.run_dir, args.module_dir, args.entrypoint, args.inputs_dir, capabilities, limits)


if __name__ == "__main__":
    raise SystemExit(main())
