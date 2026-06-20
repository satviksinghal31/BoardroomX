# Rolling Supertrend Backtest Design

## Goal

Build a rolling forward simulator that answers: if we sat on each historical day with only past data, waited for a valid Supertrend setup, and deployed Rs 1,00,000 for 1/2/3/6 month horizons, what distribution of outcomes would we have seen?

## Scope

The simulator covers NSE daily OHLCV data fetched from Yahoo Finance and cached locally. It evaluates single-stock paths and aggregate summary statistics for selected symbols and fresh-momentum candidates.

## Execution Model

- Anchor date `T`: the date from which the forward simulation starts.
- Horizons: 21, 42, 63, and 126 trading days.
- Entry signal: Supertrend flips red-to-green after anchor `T`.
- Entry fill: next trading day open after the signal.
- Exit signals: close below 21 DMA or Supertrend flips green-to-red.
- Exit fill modes:
  - `same_close`: fill at the signal day's close, approximating a 3:20-3:25 PM live exit decision.
  - `next_open`: fill at the next trading day open, conservative no-lookahead benchmark.
- If no entry occurs inside the horizon, capital remains cash.
- If still in position at horizon end, mark to market at horizon close for valuation but record that separately from signal exits.

## Strategy Variants

### R1_ST_200DMA

- Entry: Supertrend red-to-green and close above 200 DMA.
- Initial deployment: 100% of starting capital.
- Exit: 21 DMA breakdown or Supertrend red.
- Re-entry: only after a new red-to-green Supertrend flip.

### R2_ST_DMA_STACK

- Entry: Supertrend red-to-green, close above 100 DMA and 200 DMA, and 50 DMA rising.
- Initial deployment: 100% of starting capital.
- Exit: 21 DMA breakdown or Supertrend red.
- Re-entry: only after a new red-to-green Supertrend flip.

### R3_ST_DMA_STACK_ADD

- Entry: same as R2.
- Initial deployment: 50% of starting capital.
- Add 25% if close is at least 5% above weighted entry and the trailing stop has moved above the initial stop.
- Add remaining 25% if close is at least 10% above weighted entry and 21 DMA is above weighted entry.
- Exit: 21 DMA breakdown or Supertrend red.
- No averaging down.

## Reporting

For each symbol, strategy, exit mode, and horizon:

- Number of anchor simulations.
- Number and rate of no-entry outcomes.
- Mean, median, p5, p95 returns.
- Win rate.
- Average ending value of Rs 1,00,000.
- Average max drawdown.
- Average entries and re-entries.
- Exit reason counts.

The script also reports current latest-candle state for selected symbols and fresh momentum names.

## Known Limitations

- Daily data cannot truly know the 3:25 PM state. `same_close` is a practical approximation and should be compared against `next_open`.
- Yahoo adjusted close is not perfectly consistent with raw OHLC for split-adjusted ATR; this is acceptable for first-pass research but should be audited before live capital.
- Rolling daily anchors are overlapping and correlated; the result is a distribution of historical episodes, not independent statistical trials.
