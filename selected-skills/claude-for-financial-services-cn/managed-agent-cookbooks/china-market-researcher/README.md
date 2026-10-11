# China Market Researcher — managed-agent cookbook

## Overview

A-share sector or theme → industry overview, competitive landscape, peer comps, and ideas shortlist. Same source as the [`china-market-researcher`](../../agent-plugins/china-market-researcher) Cowork plugin — this directory is the Managed Agent cookbook for `POST /v1/agents`.

## Deploy

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AKSHARE_MCP_URL=... CHINA_NEWS_MCP_URL=...
../../scripts/deploy-managed-agent.sh china-market-researcher
```

## Steering events

See [`steering-examples.json`](./steering-examples.json). Fan out across a coverage list from your orchestration layer — one session per sector/theme.

## Security & handoffs

Transcripts and filings are untrusted. Three-tier isolation:

| Tier | Touches untrusted docs? | Tools | Connectors |
|---|---|---|---|
| **`sector-reader`** | **Yes** | `Read`, `Grep` only | None |
| `comps-spreader` / Orchestrator | No | `Read`, `Grep`, `Glob`, `Agent` | AkShare, China-news (read-only) |
| **`note-writer`** (Write-holder) | No | `Read`, `Write`, `Edit` | None |

`sector-reader` returns length-capped, schema-validated JSON. `note-writer` produces `./out/research-<sector>.docx` and `./out/comps-<sector>.xlsx` via `pptx-author` / `xlsx-author`.

**Handoff:** to initiate coverage on a shortlisted name, emit a `handoff_request` for `china-earnings-reviewer` or `china-pitch-agent`; `scripts/orchestrate.py` routes it as a new steering event.
