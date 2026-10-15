# Language Mode

Part 3 of 3 for `10k-digest` — Language Mode; File Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Language Mode

When `--lang zh-TW` is specified, output the **entire document** in Traditional Chinese (繁體中文), including:
- All section headings translated
- All narrative summaries written in Traditional Chinese
- All tables with Chinese column headers
- Cover block language field: `語言：繁體中文`
- Keep ticker symbols, financial figures, and SEC item numbers in their original form

Suggested Traditional Chinese headings for the interpretation sections: 亮點與隱憂 (Highlights & Concerns), 管理層展望 (Management Outlook & Forward Guidance), 上年度承諾兌現 (Prior-Year Promise Tracker), 多空對決 (Bull vs. Bear Synthesis).

English mode is the default when no `--lang` flag is given.

---

## File Output

When `--output <filename>` is specified:
- Save the digest as a markdown file at the specified path
- If no path separator is present, save in the current directory
- Confirm the file path after saving: `✓ Digest saved to: <path>`
- Default filename if `--output` flag is present without a name: `<TICKER>-10k-digest.md`

---

## Thesis Invalidation

After delivering the digest, note what would make this document stale:

**Re-run this digest when:**
- [ ] Company files next 10-K or 10-K/A amendment
- [ ] Material 8-K filed disclosing a restatement or auditor change
- [ ] 12 months have elapsed since the filing date

```
╔══════════════════════════════════════════════╗
║              INVESTMENT SIGNAL               ║
╠══════════════════════════════════════════════╣
║ Signal:      BULLISH / NEUTRAL / BEARISH     ║
║ Confidence:  HIGH / MEDIUM / LOW             ║
║ Horizon:     SHORT / MEDIUM / LONG-TERM      ║
║ Score:       X.X / 10                        ║
╠══════════════════════════════════════════════╣
║ Action:      BUY / HOLD / SELL               ║
║ Conviction:  STRONG / MODERATE / WEAK        ║
╚══════════════════════════════════════════════╝
```

Score Guide: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
Confidence: HIGH (strong data, clear signals) | MEDIUM (mixed signals) | LOW (limited data, conflicting signals)
Horizon: SHORT-TERM (1 week–3 months) | MEDIUM-TERM (3 months–1 year) | LONG-TERM (1+ years)

**Disclaimer:** Educational analysis only. Not financial advice.


