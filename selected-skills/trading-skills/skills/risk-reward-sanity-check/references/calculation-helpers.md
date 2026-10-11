# Calculation Helpers

What to work out, and where the numbers come from in this plugin: this much arithmetic is small
enough to show in the reply, and the analysis role has no shell and runs no helper scripts. When more
than one trade is involved, hand the rows and the statistic wanted to the host's data side — in a
role-split host, the agent that owns statistics — and use only what comes back.

The measures this skill cares about:

- `risk_reward_ratio` — the distance from entry to target divided by the distance from entry to stop,
  per unit of the instrument (a contract multiplier scales both sides alike)
- `expectancy` — win rate times average win, minus the loss rate times average loss

Use the math only as a cross-check for the proposed structure. Do not let a favorable ratio override weak thesis support, event risk, or unrealistic target logic.
