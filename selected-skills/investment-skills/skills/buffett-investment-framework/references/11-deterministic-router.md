# Deterministic Router

Use the bundled deterministic router when the host gives this role a shell **and** this skill's directory is reachable. Where either is missing — a role-split host that grants no shell, or an install without `scripts/` — skip the router and open the `references/` file for the chosen module directly, using the mapping in *Choose the Workflow* in `SKILL.md`. The router only decides which file to read; it holds no analysis of its own, so nothing is lost by reading the file.
From the skill directory, run:

```bash
python3 scripts/framework.py route --intent financial-analysis --topic insurance
python3 scripts/framework.py route --intent memo-review --topic acquisition
python3 scripts/framework.py show --id C08
python3 scripts/framework.py validate
```
