[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/bede328/btc-race-24h-20261123-0511-mr/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/bede328/btc-race-24h-20261123-0511-mr/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

# btc-race-24h-20261123-0511-mr

Mean-reversion BTC trading bot for the make.fun competition
`btc-race-24h-20261123-0511` ("Race a BTC trading bot live for 24 hours").
Trades cbBTC/USDC on 1-minute bars, long only, $1000 paper, full size.

## Strategy

Short-range dip-buy + trend-ride (v3 / Fluent Ember lineage, re-tuned for
this dev window):

- **Entry:** close in the bottom 15% of the trailing 60-bar (1h) range,
  close turned up vs the previous bar, bar closed above its own open,
  ≥90 bars since the last exit, no entries after bar 1320.
- **Exit:** 2.2% trailing stop off the peak close since entry, −1.5% hard
  stop, or 600 bars max hold. **No range-top sell** — in this trending
  window the 85% range-top exit leaves the rally on the table.
- **Size:** all cash in, whole position out. One open position.

Why the short range: the dev window rallies +2.5% in ~60 min around bar
~226, then grinds sideways $60.4k–$61.8k. A 480-bar range stays pinned at
the pre-rally floor, so v3-as-is fires almost never (+$7.24). A 60-bar
range re-anchors after the rally and dips keep firing in the grind.

## Grade-local (dev window)

```
net PnL   34.588598 USDC  (return +3.46%)
trading   3 trades, win rate 1.000, max drawdown 1.81%
fees      1.636949 USDC; at 2x fees net PnL 32.938252 USDC
guardrails met
action_log_sha256 4afff5739d5d68024116cd18c402e8177fbb7a9847cc337f0564167fbf3a51e9
L1 regrade reproduced byte for byte; two separate grade-local runs byte-identical
```

Buy-and-hold on the same window is +$36.39; this bot keeps 95% of it with
two timed entries (buy bar 148 pre-rally @ ~$59,046, sell bar 749 @
~$60,776; buy bar 914 @ ~$60,612, held to the final flatten).

## Sweep (local simulator, fee 4bps + slippage 2bps + impact; harness agrees to the cent)

| Config | Dev PnL | Trades | MaxDD |
|---|---|---|---|
| **Final: LB60 buy .15 trail 2.2% MH600 CD90 stop −1.5%** | **+$34.59** | 2 sells* | 1.89% |
| LB60 buy .10 MH600 trail 2.0% CD30 | +$34.59 | 2 | 1.89% |
| LB60 buy .20 MH600 trail 2.0% CD30 | +$32.72 | 3 | 1.95% |
| LB60 buy .25 MH600 trail 2.0% CD30 | +$32.40 | 3 | 1.95% |
| LB60 buy .15 MH720 trail 2.0% CD30 | +$30.80 | 2 | 2.24% |
| LB60 buy .15 MH480 trail 2.0% CD30 | +$26.02 | 3 | 2.71% |
| LB60 buy .15 MH600 trail 1.8% CD30 | +$27.19 | 3 | 2.60% |
| LB30 buy .20 MH720 trail 2.0% CD30 | +$36.46 | 2 | 2.05% |
| LB60 buy .20 MH360 trail 2.0% CD30 | +$35.15 | 3 | 2.30% |
| v3 port (LB480 buy .15 sell .85) | +$7.24 | 2 | 1.10% |
| Best v3-shape (LB240 buy .10 sell .90) | +$17.29 | 3 | 0.90% |
| Fluent Ember best (W60, z −1.5, dip 0.8%) | +$10.01 | 3 | 1.53% |
| Breakout arm best (LB60, trail 0.8%) | +$2.74 | 6 | 2.36% |

\* "Trades" here counts signal sells in the simulator (the harness counts
3 filled orders: 2 buys + 1 signal sell; the final flatten is the
harness's own close). Plateau: buy band 0.10–0.25, max hold 480–720 and
trailing 2.0–2.5% all give +$26–35 — the family, not one spike.

## Robustness (simulator; same engine that matched the harness to the cent)

- Time-reversed dev window: **−$25.13**
- Prices flipped around their mean: **−$23.87**
- 24 block-bootstrap resamples (60-bar return blocks): median **+$20.40**,
  positive 20/24, min −$18.74, max +$98.43

Honest read: this is a trend-riding long-only bot. It loses on a
mirror-image downtrend (the 90-bar cooldown is what keeps that loss at
~−$24 instead of ~−$58 with a 30-bar cooldown). It earns its keep when
the window trends up or grinds sideways after a rally — which is what
the dev window does, and what the race window follows chronologically.

## Files

- `main.ts` — the bot (Node 22, TypeScript erasable syntax).
- `vendor/makefun-bars.ts` — kit SDK shim, byte-identical copy.
- `LICENSE` — MIT.
