#!/usr/bin/env python3
"""Sync skills from vertical-plugins/china-finance into agent-plugins/*.

Usage:
    python3 scripts/sync-china-skills.py          # copy all
    python3 scripts/sync-china-skills.py --check  # dry-run, report drift only
"""

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

CHINA_DIR = Path(__file__).resolve().parent.parent


def find_agents_with_skills() -> list[tuple[str, str]]:
    """Return (agent_slug, vertical_name) pairs that bundle skills."""
    agents = []
    for agent_dir in (CHINA_DIR / "agent-plugins").iterdir():
        if not agent_dir.is_dir():
            continue
        agent_name = agent_dir.name
        prompt_file = agent_dir / "agents" / f"{agent_name}.md"
        if not prompt_file.exists():
            continue
        # Check if the agent bundles skills by looking at its agents/*.md
        text = prompt_file.read_text(encoding="utf-8")
        if "## Skills this agent uses" in text or "skills" in text.lower():
            agents.append((agent_name, "china-finance"))
    return agents


def sync_skill(agent_slug: str, vertical: str, skill_name: str, check_only: bool) -> bool:
    """Sync a single skill from vertical to agent. Returns True if changed."""
    src = CHINA_DIR / "vertical-plugins" / vertical / "skills" / skill_name
    dst = CHINA_DIR / "agent-plugins" / agent_slug / "skills" / skill_name

    if not src.exists():
        return False

    dst.mkdir(parents=True, exist_ok=True)

    for fname in ["SKILL.md"]:
        src_file = src / fname
        dst_file = dst / fname
        if not src_file.exists():
            continue

        if dst_file.exists() and filecmp.cmp(src_file, dst_file, shallow=False):
            continue

        if check_only:
            print(f"[CHECK] {agent_slug}/{skill_name}/{fname} would be updated")
            return True

        shutil.copy2(src_file, dst_file)
        print(f"[SYNC] {agent_slug}/{skill_name}/{fname}")
        return True

    return False


def main():
    parser = argparse.ArgumentParser(description="Sync China skills from vertical-plugins to agent-plugins")
    parser.add_argument("--check", action="store_true", help="Dry-run, report drift only")
    args = parser.parse_args()

    changed = 0
    pairs = find_agents_with_skills()

    if not pairs:
        print("No agents with skill dependencies found.", file=sys.stderr)
        sys.exit(0)

    for agent_slug, vertical in pairs:
        vert_skills_dir = CHINA_DIR / "vertical-plugins" / vertical / "skills"
        if not vert_skills_dir.exists():
            continue
        for skill_dir in vert_skills_dir.iterdir():
            if skill_dir.is_dir():
                if sync_skill(agent_slug, vertical, skill_dir.name, args.check):
                    changed += 1

    if args.check:
        if changed:
            print(f"\n{changed} file(s) have drifted. Run without --check to sync.")
        else:
            print("All skills in sync.")
    else:
        print(f"\nSynced {changed} file(s).")


if __name__ == "__main__":
    main()
