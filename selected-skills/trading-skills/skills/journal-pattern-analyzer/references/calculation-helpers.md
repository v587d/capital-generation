# Calculation Helpers

What to work out, and where the numbers come from in this plugin: the analysis role has no shell and
runs no helper scripts. Hand the journal sample and the statistics wanted to the host's data side
(in a role-split host, the agent that owns statistics and quality checks), or show the arithmetic in
the reply when the sample is only a few trades.

The measures this skill cares about:

- `expectancy` — win rate times average win, minus the loss rate times average loss; also worth
  stating in R units (that same number divided by the average loss)
- `kelly_fraction` — a reference number from win rate and payoff ratio, never a size to hand the user

When the journal includes structured results, combine these measures with simple grouped summaries of
win rate, average win, average loss, and loss clustering. Keep any conclusions provisional when the
sample is small or inconsistently tagged.
