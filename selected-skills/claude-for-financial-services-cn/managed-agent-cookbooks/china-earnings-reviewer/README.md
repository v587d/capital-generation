# China Earnings Reviewer — managed-agent cookbook

## Overview

A-share earnings call + filings → model update → variance table → earnings note. Same source as the [`china-earnings-reviewer`](../../agent-plugins/china-earnings-reviewer) Cowork plugin — this directory is the Managed Agent cookbook for `POST /v1/agents`.

## Deploy

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AKSHARE_MCP_URL=... CHINA_NEWS_MCP_URL=...
../../scripts/deploy-managed-agent.sh china-earnings-reviewer
```

## Steering events

See [`steering-examples.json`](./steering-examples.json). Fan out across a coverage list from your orchestration layer — one session per ticker.

## Security & handoffs

Transcripts and filings are untrusted. Three-tier isolation:

| Tier | Touches untrusted docs? | Tools | Connectors |
|---|---|---|---|
| **`data-reader`** | **Yes** | `Read`, `Grep` only | None |
| `model-updater` / Orchestrator | No | `Read`, `Grep`, `Glob`, `Agent` | AkShare, China-news (read-only) |
| **`note-writer`** (Write-holder) | No | `Read`, `Write`, `Edit` | None |

`data-reader` returns length-capped, schema-validated JSON. `note-writer` produces `./out/note-<ticker>.docx` and the updated model at `./out/model-<ticker>.xlsx`.

**Handoff:** to rebuild a DCF after an earnings-driven thesis change, emit a `handoff_request` for `china-model-builder`; `scripts/orchestrate.py` routes it as a new steering event.
