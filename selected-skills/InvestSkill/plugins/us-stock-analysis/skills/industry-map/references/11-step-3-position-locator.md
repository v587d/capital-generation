# 4. Step 3 — Position Locator

Part 2 of 3 for `industry-map` — 4. Step 3 — Position Locator; 5. Step 4 — Chokepoint & Bottleneck Analysis; 6. Step 5 — Value-Pool & Margin Migration; 7. Step 6 — Concentration & Supply-Chain Risk; 8. Step 7 — Investment Idea Generation; 9. Worked Example — AI Compute Stack; 10. Input Formats
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 4. Step 3 — Position Locator

If the user supplied a ticker, pin it precisely:

- **Which node** does it occupy? (a company may span several — e.g. Amazon is both CSP and end-market retailer)
- **Its upstream dependencies**: who must it buy from, and how substitutable are they? (single-source dependency = risk)
- **Its downstream customers**: who buys from it, how concentrated are they, and can they build it in-house or switch?
- **Direction of pricing power**: does value flow *toward* this node (it can raise prices) or *away* (it is squeezed between a strong supplier and a strong buyer)?

State the one-line takeaway: *"[Ticker] sits [upstream/mid/down] at the [layer] node; it depends on [supplier layer] and sells into [customer layer]; pricing power currently favors [node]."*

---

## 5. Step 4 — Chokepoint & Bottleneck Analysis

This is where the alpha usually is. Walk the chain and score each layer for **bottleneck power** — the ability to hold up the entire chain:

```
Bottleneck Score (per layer, 0–10) = average of these four factors, each scored 0–10:
- Supplier scarcity      (fewer credible suppliers = higher)
- Substitutability       (no viable alternative = higher)
- Switching cost / lead  (longer to qualify a new supplier = higher)
- Demand inelasticity    (chain cannot proceed without it = higher)
```

Layers scoring high are **toll collectors**: they capture value regardless of who wins downstream. Classic examples to reason by analogy from: ASML (sole EUV supplier), TSMC (leading-edge foundry), NVDA + CUDA (accelerator + software lock-in). Explicitly flag:
- **Where the bottleneck is today**
- **Whether it is durable** or being competed / engineered away (second sources, in-housing, new architectures)
- **The "arms dealer" thesis**: a bottleneck layer often wins no matter which downstream competitor prevails

---

## 6. Step 5 — Value-Pool & Margin Migration

The profit pool is dynamic. Map where margin sits **now** and build a thesis for where it goes **next**:

- **Current margin map**: which layer earns the fat gross/operating margins, and which is a thin-margin commodity pass-through?
- **Scarcity shift**: today's bottleneck gets competed away or over-built; a new one forms elsewhere. (e.g. compute scarcity today → energy/power and data scarcity next; hardware margins → software/services over time.)
- **Value migration direction**: is value moving **downstream** (toward platforms and apps as hardware commoditizes) or **upstream** (toward whoever controls the newly scarce input)?
- **What to expect in the future**: name the layer likely to capture incremental value over the next 1–3 years and the *trigger* that would confirm it (capacity coming online, a standard emerging, an input going scarce).

This is the section that turns a static picture into a forward-looking investment view.

---

## 7. Step 6 — Concentration & Supply-Chain Risk

A chain view exposes fragility that a single-stock view misses:

- **Single-source / single-region chokepoints** (e.g. Taiwan foundry concentration, rare-earth processing in one country)
- **Geopolitical exposure**: export controls, tariffs, sanctions that could sever an edge in the graph
- **Cascade risk**: if one upstream node fails, how far downstream does the disruption propagate?
- **Inventory / bullwhip dynamics**: demand signals amplifying up the chain (over-ordering, then a glut) — especially in memory and components
- **Customer concentration at each node**: a layer selling >30% to one downstream buyer inherits that buyer's fate

---

## 8. Step 7 — Investment Idea Generation

Turn the map into a ranked idea list, organized by layer:

```
Layer            Best-positioned names   Rationale                         Idea type
────────────────────────────────────────────────────────────────────────────────────────
Bottleneck       [tickers]               Durable toll on the whole theme   Core / "arms dealer"
Direct winner    [tickers]               Obvious primary beneficiary        Consensus long
2nd-order        [tickers]               Sells picks-and-shovels to winners Under-covered
Squeezed         [tickers]               Caught between strong up/down      Avoid / short candidate
Optionality      [tickers]               Cheap exposure if value migrates   Speculative
```

Flag the **non-obvious** node — the second-order supplier the market under-covers because it isn't a pure-play on the theme. Hand the shortlist to `stock-screener` to rank, or `competitor-analysis` to check each name's moat, or `bear-case` to stress-test the consensus winner.

---

## 9. Worked Example — AI Compute Stack

Reading the map above:
- **Chokepoints**: Fab Equipment (ASML EUV monopoly) and GPU/Accelerators (NVDA + CUDA). These are the durable toll collectors today.
- **Value pool now**: concentrated at the GPU and foundry layers; CSPs are absorbing heavy capex; model labs are largely unprofitable.
- **Migration thesis**: as accelerator supply catches up, incremental scarcity shifts toward **power/energy and networking**, and value accrues to **software/inference** that monetizes the installed base. Watch for the trigger: accelerator lead times normalizing.
- **Idea shape**: core = the bottleneck arms dealers; 2nd-order = power, cooling, interconnect, and HBM memory suppliers the market under-weights; avoid = undifferentiated app-layer names with no data moat.

---

## 10. Input Formats

```
# Map a full theme end-to-end
/industry-map "AI compute"

# Map the chain around a ticker, then locate it
/industry-map NVDA

# Focus on one layer + its neighbors
/industry-map semiconductors --layer memory

# Emphasize where value migrates next
/industry-map "electric vehicles" --focus value-migration

# Emit chart-ready graph spec for a report
/industry-map "GLP-1 drugs" --visual
```

---


