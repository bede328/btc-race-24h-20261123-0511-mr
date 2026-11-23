// Short-range dip-buy + trend-ride bot for cbBTC (CBBTC), 1-minute bars.
// make.fun btc-race-24h-20261123-0511, mean-reversion family (v3 / Fluent Ember
// lineage), re-tuned for THIS dev window.
//
// What the dev window looks like (frozen, 1440 bars): BTC $58.957 -> $61.102
// (+3.64%), buy-and-hold +$36.39, maxDD 1.98%. One big rally of +2.5% in ~60
// minutes around bar ~226, then a slow grind sideways between ~$60.4k and
// ~$61.8k for the remaining ~1100 bars. 1m return stdev 8.1 bps.
//
// Why this is NOT a straight port of v3 (480-bar range, sell at 85% of the
// range): on this window v3-as-is scores only ~+$7. The 480-bar range's low
// stays pinned at the pre-rally floor for hours, so the 15% buy band almost
// never fires after the rally, and the 85% sell band exits every trade just
// as the grind resumes. The range-top exit is the wrong exit in a trending
// window: it leaves the rally on the table.
//
// Adaptation, validated by sweep on the dev window (see sweep notes below):
//   - Short 60-bar (1h) range, so the range re-anchors to the new level
//     after the rally and dips keep firing in the grind.
//   - Entry: close in the bottom 15% of the trailing 60-bar range, close
//     turned up vs the previous bar, bar closed above its own open, and at
//     least 90 bars since the last exit (a longer cooldown than v3's 60:
//     identical dev PnL, but it stops the bot re-entering a falling knife on
//     the stress windows — see below).
//   - Exit: NO range-top sell. Instead a 2.2% trailing stop off the peak
//     close since entry (lets the trade ride the rally and the grind),
//     a -1.5% hard stop, or 600 bars max hold. No new entries in the last
//     120 bars (a late entry would be force-flattened before it can pay).
//   - Size: all cash on entry, whole position on exit. One open position.
//
// Sweep evidence (local simulator, fee 4bps + slippage 2bps + impact vs
// next-bar open depth; grade-local is authoritative, see README numbers):
//   - v3 port (480/0.15/0.85): +$7.24, 2 trades. Best v3-shape (240/0.10/
//     0.90): +$17.29, 3 trades. Fluent Ember shapes: +$5-10. Breakout arm
//     (buy new trailing high): -$10 to -$40 — new highs reverse here too.
//   - This bot: +$34.59 dev, 2 round trips, maxDD 1.89%. Plateau, not a
//     spike: buy band 0.10-0.25 gives +$32.40-34.59, max hold 480-720 gives
//     +$26.02-34.59, trailing 2.0-2.5% gives the same +$34.59, cooldown
//     30-150 bars gives the same +$34.59. The family "short range + wide
//     trail + long hold" is +$26-36 across the whole neighbourhood.
//   - Stress (same logic, dev window transformed): time-reversed -$25.13,
//     prices flipped around their mean -$23.87. A trend-riding long-only
//     bot loses on a mirror-image downtrend — that is the honest cost of
//     riding; the 90-bar cooldown is what keeps the flipped loss at -$24
//     instead of -$58 (30-bar cooldown). Block-bootstrap (24 resamples of
//     60-bar return blocks): median +$20.40, positive 20/24.
//   - Trade log (dev): buy bar 148 @ ~$59,046 (pre-rally dip), sell bar
//     749 @ ~$60,776 (max hold, +$28.48); buy bar 914 @ ~$60,612, held to
//     the final flatten (~$61,102).
//
// Grade-local (kit, --worktree, driver process), first run:
//   net PnL +$34.588598 (return +3.46%), 3 trades, win rate 1.000,
//   max drawdown 1.81%, fees $1.636949, net PnL at 2x fees +$32.938252,
//   guardrails met, L1 regrade reproduced byte for byte.
//   action_log_sha256 4afff5739d5d68024116cd18c402e8177fbb7a9847cc337f0564167fbf3a51e9
//   (local simulator predicted +$34.59 / DD 1.89% — the harness agrees to
//   within a cent, so the simulator's sweep numbers above are trustworthy.)
//   The no-entry-after-1320 guard never binds on the dev window (last entry
//   is bar 914); it is insurance for the race window only.
//
// Deterministic: no clock, no randomness, no network, no files. All state
// comes from the bars the harness sends.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 60; // bars in the trading range (1h)
const BUY_PCT = 0.15; // enter at or below this fraction of the range
const HARD_STOP = 0.985; // exit if close falls to entry x this (-1.5%)
const TRAILING_PCT = 0.022; // exit if close falls 2.2% below the peak close since entry
const MAX_HOLD_BARS = 600; // exit after this many bars in the position
const COOLDOWN_BARS = 90; // wait this long after an exit before re-entering
const NO_ENTRY_AFTER_SEQ = 1320; // no new entries in the last 120 bars
const MAX_SLIPPAGE_BPS = 150; // generous: 1m moves are ~8 bps stdev

// Closes as raw price integers (price_scale 5); scale cancels in ratios.
const closes: number[] = [];
let entryClose = 0;
let entrySeq = -1;
let lastExitSeq = -1000000;
let peakClose = 0;

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    if (state.warmingUp) {
      closes.push(Number(bar.c));
      return [];
    }
    closes.push(Number(bar.c));
    const close = closes[closes.length - 1]!;
    const prev = closes.length > 1 ? closes[closes.length - 2]! : close;
    const open = Number(bar.o);

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;
    const inPosition = qty > 0n;

    if (closes.length < LOOKBACK) return [];

    // Trailing range over the last LOOKBACK closes (including this one).
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = closes.length - LOOKBACK; i < closes.length; i++) {
      const c = closes[i]!;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    if (!(hi > lo)) return [];
    const pct = (close - lo) / (hi - lo);

    if (!inPosition) {
      if (state.seq > NO_ENTRY_AFTER_SEQ) return [];
      if (pct > BUY_PCT) return [];
      if (!(close > prev)) return []; // wait for the dip to turn up
      if (!(close > open)) return []; // and for the bar to close up, not down
      if (state.seq - lastExitSeq < COOLDOWN_BARS) return []; // no whipsaw re-entry
      if (state.cash <= 0n) return [];
      entryClose = close;
      entrySeq = state.seq;
      peakClose = close;
      return [
        {
          side: 'buy',
          symbol: SYMBOL,
          notional_quote_units: state.cash,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }

    // In position: track the peak close since entry for the trailing stop.
    if (close > peakClose) peakClose = close;
    // Exit on hard stop, max hold, or a 2.2% pullback from the peak close.
    const held = state.seq - entrySeq;
    if (
      close <= entryClose * HARD_STOP ||
      held >= MAX_HOLD_BARS ||
      close <= peakClose * (1 - TRAILING_PCT)
    ) {
      lastExitSeq = state.seq;
      return [
        {
          side: 'sell',
          symbol: SYMBOL,
          qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
