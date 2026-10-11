# Peter Lynch Skill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Open%20Standard-111827?style=flat-square)](https://agentskills.io/home)

An [Agent Skills](https://agentskills.io/home) open-standard skill for Peter
Lynch-style public company research. Give it a ticker or company name, choose a
quick screen or a deep dive, and it guides a compatible AI agent through current
web research, source verification, and a cited markdown report.

This repository is a skill package, not a web application. It has no Django
server, database, frontend build, bundled data fetcher or project-specific API keys. The skill relies on the host
agent's web search and page-fetch tools.

## About Peter Lynch

Peter Lynch ran the **Fidelity Magellan Fund** from 1977 to 1990, delivering an
average annual return of 29.2%, beating the S&P 500 index — making it one of the
best-performing mutual funds in history.

His investment philosophy is grounded in a simple but powerful idea: ordinary
investors have a real edge when they pay attention to the world around them.

- **Invest in what you understand** — focus on businesses whose products,
  services, and revenue model you can clearly explain.
- **Focus on fundamentals** — prioritize earnings growth, financial health, and
  business quality over short-term market movements or predictions.
- **Growth at a reasonable price (GARP)** — seek companies that combine solid
  growth with sensible valuation.
- **Think long-term** — durable business performance matters far more than
  short-term market noise.
- **Use your individual advantage** — everyday observations can help you spot
  great investments before Wall Street does.

> *"The person that turns over the most rocks wins the game."* — Peter Lynch

He is best known for the books: **Learn to Earn**, **One Up on Wall Street**,
and **Beating the Street**.

<br />

<table align="center">
  <tr>
    <td align="center" width="220">
      <img src="https://raw.githubusercontent.com/DjNero11/fundamentalio/refs/heads/main/fundamentalio/static/img/LearnToEarn.jpg" width="180" alt="Peter Lynch portrait" /><br />
      <sub><b>Peter Lynch</b></sub><br />
    </td>
    <td align="center" width="160">
      <img src="https://raw.githubusercontent.com/DjNero11/fundamentalio/refs/heads/main/fundamentalio/static/img/once_up.jpg" width="130" alt="One Up on Wall Street" /><br />
      <sub><b>One Up on Wall Street</b></sub><br />
    </td>
    <td align="center" width="160">
      <img src="https://raw.githubusercontent.com/DjNero11/fundamentalio/refs/heads/main/fundamentalio/static/img/beating_the_street.jpg" width="130" alt="Beating the Street" /><br />
      <sub><b>Beating the Street</b></sub><br />
    </td>
  </tr>
</table>

<br />

I created this project to see whether AI agents could generate stock research
reports inspired by **Peter Lynch's** investing philosophy. After a few months
of analyzing his books and iterating on the methodology/prompt engineering, it started
producing surprisingly useful reports.

## What It Does

The skill supports two research workflows:

| Workflow | Purpose | Evidence base | Output |
|---|---|---|---|
| Quick Research | Decide whether a company deserves deeper research | Reputable financial-data aggregators | Up to 450 words with a `SKIP`, `WATCHLIST`, or `DEEP RESEARCH` decision |
| Deep Research | Produce full due diligence | Annual reports, filings, official company materials, live market data, and targeted external sources | Up to 3000 words with an attractiveness score out of 10 |

Both workflows are designed around evidence discipline:

- Use the smallest reliable source set that can support the conclusion.
- Date time-sensitive market data.
- Cite every web-derived factual claim with a linked `source:` line.
- Do not invent missing financial data.
- Do not expose research scratchwork in the final report unless the user asks for it.

## Quick Research

Quick Research is a triage workflow. It answers one practical question:

> Is this company worth spending 2-5 hours researching in detail?

The quick workflow intentionally avoids annual reports, full filings, SEC detail
pages, company quarterly reports, and long investor-relations documents. It uses
reputable aggregator pages for identity, business description, financial trends,
cash flow, balance sheet risk, valuation, and recent trend checks.

Default evidence budget:

- 1-3 aggregator sources
- 2-3 searches
- 2-3 page fetches

The report follows the quick methodology in
[references/quick/methodology.md](references/quick/methodology.md) and ends with
one of these decisions:

- `SKIP`
- `WATCHLIST`
- `DEEP RESEARCH`

## Deep Research

Deep Research is a full due-diligence workflow. It starts with official sources
and treats the latest annual report, 10-K, 20-F, or equivalent full-year filing
as the factual base whenever available.

The deep workflow then fills methodology gaps with targeted external sources for
items such as live valuation, ownership, insider activity, peer context,
industry structure, recession resilience, recent updates, and material legal or
regulatory risks.

Default evidence budget:

- 7-10 sources
- 8-12 searches
- 10-16 page or document fetches

The report follows the deep methodology in
[references/deep/methodology.md](references/deep/methodology.md) and ends with
an attractiveness score:

```text
Attractiveness score: X / 10
```

## How To Use

Install the folder in any AI tool that supports the Agent Skills format, then
ask for research by ticker or company name.

Example prompts:

```text
Quick research MSFT
```

```text
Do a quick screen of ASML.AS
```

```text
Do a deep research on IBM company
```

```text
Full analysis of Nintendo, Japan listing
```

If the request is ambiguous, the skill asks whether you want quick screening or
deep due diligence. If only a brand, ambiguous company name, or ambiguous ticker
is provided, the skill resolves the traded entity before analysis.

Useful optional hints:

- ticker
- exchange
- country
- primary listing
- company name if the ticker is ambiguous

Do not provide API keys or annual report PDFs. The skill is designed to find the
needed public sources through the host agent's browsing tools.

## Installation

Installation is client-specific. Agent Skills are supported by multiple AI tools
and agentic clients; use the official
[Client Showcase](https://agentskills.io/clients) to find instructions for your
tool.

Make sure that all .md files are included when you install the skill.

## Repository Structure

```text
.
|-- SKILL.md
|-- references
|   |-- disclaimer.md
|   |-- filing-rules.md
|   |-- quick
|   |   |-- methodology.md
|   |   |-- system-prompt.md
|   |   `-- web-research.md
|   `-- deep
|       |-- methodology.md
|       |-- system-prompt.md
|       `-- web-research.md
|-- LICENSE
`-- README.md
```

## How The Files Work Together

The skill is intentionally split into a small entrypoint and focused reference
files. A compatible agent first sees only the metadata in [SKILL.md](SKILL.md).
When a stock-research request matches the description, the agent reads the full
skill instructions, chooses Quick or Deep Research, then loads only the
workflow-specific reference files it needs.

The normal flow is:

1. [SKILL.md](SKILL.md) routes the request and sets the operating rules.
2. A workflow-specific `web-research.md` file tells the agent what sources to
   gather and when to stop.
3. A workflow-specific `methodology.md` file defines the analytical checklist.
4. A workflow-specific `system-prompt.md` file constrains the final report
   format, citations, and language.
5. [references/disclaimer.md](references/disclaimer.md) is appended after the
   report body.

## File Guide

| File | What it does | Edit this when... |
|---|---|---|
| [SKILL.md](SKILL.md) | Main entrypoint. Defines the skill metadata, routing rules, required inputs, research checklist, citation standard, and failure handling. | You want to change when the skill triggers, how it chooses Quick vs Deep, or the top-level operating rules. |
| [references/quick/web-research.md](references/quick/web-research.md) | Source-gathering playbook for fast screening. Sets the aggregator-only rule, search budget, extraction targets, triggered evidence checks, and internal brief template. | Quick reports gather too much, too little, or the wrong kind of evidence. |
| [references/quick/methodology.md](references/quick/methodology.md) | Analytical framework for Quick Research. Defines understandability, diagnostic profile, fatal flaws, category checks, bonus points, and the final `SKIP` / `WATCHLIST` / `DEEP RESEARCH` decision. | You want to tune the screening philosophy or change what counts as a pass/fail signal. |
| [references/quick/system-prompt.md](references/quick/system-prompt.md) | Output constraints for Quick Research. Controls word limit, markdown style, citation placement, plain-language rules, and cross-statement validation. | Quick reports are too verbose, too vague, poorly cited, or formatted inconsistently. |
| [references/deep/web-research.md](references/deep/web-research.md) | Source-gathering playbook for due diligence. Defines annual-report discovery, official-source priority, external gap-fills, live market-data rules, and the deep research brief. | You think deep reports miss important source categories, over-browse, or fail to ground analysis in filings and official materials. |
| [references/deep/methodology.md](references/deep/methodology.md) | Full due-diligence framework. Covers business model, track record, balance sheet, cash flow, growth drivers, competition, valuation, triggered modules, and final score. | You want to expand or refine the investment analysis itself. |
| [references/deep/system-prompt.md](references/deep/system-prompt.md) | Output constraints for Deep Research. Controls report length, source priority, markdown format, citation placement, simple language, and validation rules. | You think that deep reports need a different structure, tone, citation discipline, or final-report behavior. |
| [references/filing-rules.md](references/filing-rules.md) | Special handling for regulator data, XBRL, accounting basis, ADRs, secondary listings, and banks, insurers, REITs, and other specialized financial companies. | When you notice the skill to struggle with filing data, non-US listings, or financial companies. |

## Customizing The Skill

For most changes, edit the smallest file that owns the behavior:

- Triggering or routing: [SKILL.md](SKILL.md)
- Research source selection: the relevant `web-research.md`
- Investment logic: the relevant `methodology.md`
- Final report style: the relevant `system-prompt.md`
- Legal language: [references/disclaimer.md](references/disclaimer.md)

That separation keeps the skill easier to tune. You can make Quick Research
stricter without touching Deep Research, or change Deep report formatting without
changing the source-gathering rules.

## Methodology

The research framework is inspired by the investment principles popularized in
Peter Lynch's books, especially the emphasis on understandable businesses,
earnings growth, financial strength, valuation discipline, and knowing what kind
of business you are analyzing.

The skill does not force every company into a single label. Instead, it builds a
diagnostic profile across traits such as:

- cyclicality
- turnaround status
- growth profile
- business maturity
- asset angle
- dominant analytical lenses

That profile determines which checks matter most. A cyclical company, a
turnaround, a fast grower, a stalwart-like compounder, and an asset play should
not be judged by the same shortcut.

## Citation Standard

Final reports use claim-level citations. Source lines are placed directly below
the claim they support:

```md
- Revenue grew from $10.0 billion in FY2022 to $12.0 billion in FY2024.
  source: [Annual Report (FY2024)](https://example.com/annual-report)
```

The skill should not cite a source that is absent from the internal Source
Ledger, and it should not include a factual claim unless it can trace that claim
to a linked source.

## Disclaimer

This project is independent and is not affiliated with, endorsed by, sponsored
by, or associated with Peter Lynch, Fidelity Investments, or any related
organization.

Reports generated with this skill are AI-generated and may contain errors or
inaccuracies. They are provided for educational and informational purposes only
and do not constitute financial, investment, tax, accounting, or legal advice.
Always verify information independently before making investment decisions.

The skill tends to perform poorly on companies that have recently gone public.

## License

Distributed under the **MIT License** — see [`LICENSE`](LICENSE) for details.

---

<p align="center">
  <sub>
    Created by <a href="https://www.linkedin.com/in/szymon-nycz/">Szymon Nycz</a>
    · Inspired by Peter Lynch's philosophy
  </sub>
</p>
