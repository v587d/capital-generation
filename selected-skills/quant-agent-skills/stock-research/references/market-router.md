# Market Router

Use this router before reading market-specific instructions. The routing goal is
to keep the research core shared while keeping market microstructure, data
sources, and evidence gates separate.

## Route Table

| Input shape | Primary adapter | Optional overlay | Notes |
| --- | --- | --- | --- |
| `600xxx.SH`, `601xxx.SH`, `603xxx.SH`, `688xxx.SH`, `000xxx.SZ`, `002xxx.SZ`, `300xxx.SZ`, `8xxxxx.BJ` | `markets/a-share.md` | `overlays/ah-overlay.md` if same company has H-share | A-share Eastmoney dual-store proof is mandatory for L2+. |
| `0xxxx.HK`, `xxxxx.HK`, pure H-share, HK-only listed company | `markets/h-share.md` | `overlays/adr-hk-overlay.md` if ADR exists | Eastmoney A-share reportapi noncoverage is a market boundary, not "no reports". |
| `AAPL`, `MSFT`, `NVDA`, `TSLA`, `SPCX`, `*.US`, U.S. listed common stock | `markets/us-equity.md` | `overlays/adr-hk-overlay.md` for ADR/HK dual listings | SEC/yfinance proof replaces Eastmoney. |
| `BABA/9988.HK`, `XPEV/9868.HK`, `LI/2015.HK`, `NIO/9866.HK` | Pick the primary security in the user's question | `overlays/adr-hk-overlay.md` | Company research once; execution/security overlay separately. |
| `002594.SZ/1211.HK`, `300750.SZ/HK line`, other A+H | Pick the security being evaluated for action | `overlays/ah-overlay.md` | A vs H is execution overlay, not a second company thesis. |
| User asks "find stocks", "which should enter L3", "improve research efficiency" | Do not run full L3 first | None | Use `l3-candidate-queue` before this skill. |

## Routing Rules

- If the same company has multiple listings, research the company once and put
  listing choice into an overlay.
- If the ticker is ambiguous, infer from suffix and local alias map first. If
  still ambiguous, ask for the listing instead of silently choosing.
- If a market adapter says a data source is not applicable, do not force the
  wrong market's collector to pass.
- If a U.S. ADR is a foreign private issuer and SEC `20-F/6-K` support is not
  available, mark the gap explicitly and use ADR/HK overlay or company IR as a
  documented fallback.

## Reference Loading Order

1. `core-contract.md`
2. `market-router.md`
3. one file under `markets/`
4. zero or one file under `overlays/`
5. existing detailed step files only for execution detail:
   - `steps/01-check-first.skill.md`
   - `steps/02-data-collection.skill.md`
   - `steps/03-deep-analysis.skill.md`
   - `steps/04-output-delivery.skill.md`
   - `steps/05-quality-portfolio.skill.md`

