# China Model Builder — managed-agent cookbook

## Overview

DCF, LBO, 3-statement, comps — built as a file artifact for A-share targets. Same source as the [`china-model-builder`](../../agent-plugins/china-model-builder) Cowork plugin — this directory is the Managed Agent cookbook for `POST /v1/agents`.

## Deploy

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AKSHARE_MCP_URL=...
../../scripts/deploy-managed-agent.sh china-model-builder
```

## Steering events

See [`steering-examples.json`](./steering-examples.json).

## Security & handoffs

Task-decomposition split — inputs come from trusted MCPs, so the split is about artifact isolation and re-verification. Exactly one worker holds `Write`:

| Leaf | Tools | Connectors |
|---|---|---|
| `data-puller` | `Read`, `Grep` | AkShare (read-only) |
| **`builder`** (Write-holder) | `Read`, `Write`, `Edit`, `Bash` (sandboxed) | None |
| `auditor` | `Read`, `Grep` | None |

`auditor` re-checks ties and balances after `builder` writes `./out/model.xlsx`.

**Handoff:** when invoked from `china-earnings-reviewer` or `china-pitch-agent`, the calling agent's `handoff_request` is routed here by `scripts/orchestrate.py`.
