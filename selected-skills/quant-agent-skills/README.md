# Quant Agent Skills

Production-grade quant research orchestration skills for Claude Code / Codex:
concept research, single-stock research, and industry research. Built from 6+
months of daily use on a live A-share/HK/US research loop — these are not
prompt collections, they are ~8,000 lines of encoded orchestration rules:
multi-agent debate contracts, narrative lifecycle mapping, expectation-delta
gates, closeout ordering, and three-place knowledge persistence.

## What's inside

| Skill | Version | Job |
| --- | --- | --- |
| `concept-research` | 1.3.2 | L1 panoramic scan → L2 quick eval → L3 deep dive on market narratives; maps narrative lifecycle to best vehicles and hands off to stock research |
| `stock-research` | 2.46.0 | Single-stock L2+/L3 for A-share / H-share / US / A+H / ADR-HK: 6-agent evidence, market adapters, overlays, closeout contract, five-file output |
| `industry-research` | 1.8.4 | Top-down industry mispricing detection: Check-First, fresh public signal sweep, 5-agent debate, expectation-delta guard, five-file output |

Skill content is written in Chinese (the author's working language); this
README is bilingual. English translation of the core contracts is on the
roadmap.

## Repository layout

```text
quant-agent-skills/
├── concept-research/      # narrative lifecycle → best vehicle
├── stock-research/        # single-stock L2+/L3 orchestration
├── industry-research/     # top-down industry mispricing detection
├── examples/              # fictional L3 five-file package (closeout demo)
├── docs/adaptation-guide.md  # glossary: which components are yours to swap
├── template/              # minimal workspace skeleton (SSoT file contracts)
└── scripts/               # publish pipeline + sanitization guard + smoke test
```

## Why this is different

- **Agent evidence contracts, not one-shot prompts.** Deep research runs real
  sub-agents (bull/bear, financial, industry, catalyst, risk, report) with
  explicit fallback semantics — local review is never disguised as agent output.
- **Closeout discipline.** Every research package ends with machine-checked
  gates: verdict + trigger + watchlist + bridge + loop board + Vault sync +
  quality gate, in a fixed order. Warnings and pending states are never wrapped
  as DONE.
- **Anti-look-ahead and anti-optimism rules.** Expectation-delta guard treats
  announcements as `event_occurred=true`, not thesis validation; `IN_LINE` only
  triggers review, never an upgrade.
- **Adaptation honesty.** The skills come from a specific local stack. The
  glossary in [`docs/adaptation-guide.md`](docs/adaptation-guide.md) tells you
  exactly which components are yours to substitute.

## Example output

See [`examples/`](examples/) — a complete, fictional L3 five-file package
(company, numbers, and reports are invented) showing what the closeout
contract produces: thesis → evidence chain → valuation → triggers → tracking.
It also demonstrates the safety contract: no positions, no buy/sell actions,
research conclusions routed to `re_research`/`watch`, never to trades.

## Quick start

```bash
git clone https://github.com/Howard-Jerry/quant-agent-skills
cd quant-agent-skills

# Claude Code
ln -s "$PWD/concept-research"   ~/.claude/skills/
ln -s "$PWD/stock-research"     ~/.claude/skills/
ln -s "$PWD/industry-research"  ~/.claude/skills/

# Codex (or copy instead of symlink)
ln -s "$PWD/concept-research"   ~/.codex/skills/
ln -s "$PWD/stock-research"     ~/.codex/skills/
ln -s "$PWD/industry-research"  ~/.codex/skills/
```

If a skill with the same name already exists in your skills directory, back it
up first (or copy instead of symlink). Then read the **公开版适配说明** block
at the top of each `SKILL.md` (it links the glossary) and
[`docs/adaptation-guide.md`](docs/adaptation-guide.md) before your first run.
The minimal workspace skeleton is in [`template/`](template/). To sanity-check
your clone, run `bash scripts/smoke-test.sh` — it simulates a fresh install.

> Research only. This project ships methodology, not positions: no portfolio
> data, no trade history, no API keys. Nothing here is financial advice.

## Feedback

- **Issues** — methodology bugs, missing gates, or something that burned you.
  War stories with anonymized details are the fastest way to improve the rules.
- **Discussions** — how you adapted the skills to your own data stack.
- **PRs** — welcome for `docs/`, `template/`, and `scripts/`. Skill bodies are
  synced from the author's private SSoT via `scripts/publish.sh`; propose
  methodology changes as an Issue instead (see
  [`docs/adaptation-guide.md`](docs/adaptation-guide.md)).

## Roadmap

- v1.1: open-source the data layer (`collect-data`) and candidate queue
  (`l3-candidate-queue`) that the skills reference as companions.
- v1.2: English translation of the core contracts.

## License

MIT. See [LICENSE](LICENSE).

---

# 量化研究 Agent 三件套（开源版）

面向 Claude Code / Codex 的量化研究编排 skill：概念研究、个股研究、行业研究。
不是 prompt 拼盘——是作者在真实 A 股/港股/美股研究闭环上跑了 6 个多月、
约 8000 行踩坑换来的编排规则：多 Agent 证据契约、叙事生命周期、预期差闸、
closeout 顺序、三地沉淀。

三个 skill 的版本与职责见上方表格。安装方式见 Quick start。公开版假定你
有自己的数据层和知识库，适配点全部列在 [`docs/adaptation-guide.md`](docs/adaptation-guide.md)
与 [`template/`](template/) 里。安装后可用 `bash scripts/smoke-test.sh`
自检。想看产出长什么样，直接读 [`examples/`](examples/) 里的虚构
L3 五文件包（全部数字为编造，仅演示契约）。

反馈与协作：方法论问题、踩坑案例请开 Issue；适配经验欢迎在 Discussions
交流；`docs/`、`template/`、`scripts/` 接受 PR，skill 正文按发布管线从
作者私有 SSoT 同步，方法论变更请走 Issue。

免责声明：仅供研究与教育用途，不构成投资建议；仓库不含任何实盘持仓数据。
