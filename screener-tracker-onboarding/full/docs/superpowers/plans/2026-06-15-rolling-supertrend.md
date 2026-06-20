# Rolling Supertrend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a rolling forward Supertrend simulator with realistic entry/exit fill modes and Rs 1,00,000 outcome distributions.

**Architecture:** Split reusable research logic into focused modules: indicators, market data, rolling simulator, and a CLI/report script. Keep the rolling simulator pure and unit-tested so strategy rules can evolve safely.

**Tech Stack:** Node.js ESM, `node:test`, `yahoo-finance2`, local JSON cache.

---

### Task 1: Core Rolling Simulator Tests

**Files:**
- Create: `tests/rolling-simulator.test.mjs`
- Create: `scripts/lib/rolling-simulator.mjs`

- [ ] **Step 1: Write failing tests**

Add tests covering next-open entry, same-close vs next-open exit fill, re-entry only after a fresh Supertrend green flip, and averaging-up behavior.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/rolling-simulator.test.mjs`

Expected: FAIL because `scripts/lib/rolling-simulator.mjs` does not exist yet.

- [ ] **Step 3: Implement simulator**

Create a pure simulator with `simulateRollingPath()` and `summarizeRollingResults()`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test tests/rolling-simulator.test.mjs`

Expected: PASS.

### Task 2: Indicator And Market Data Modules

**Files:**
- Create: `scripts/lib/indicators.mjs`
- Create: `scripts/lib/market-data.mjs`
- Modify: `scripts/supertrend-research.mjs`

- [ ] **Step 1: Move reusable indicator code**

Move SMA, ATR, Supertrend, returns, drawdown, and cross helpers into `scripts/lib/indicators.mjs`.

- [ ] **Step 2: Move reusable data code**

Move Yahoo aliases, Yahoo chart fetching, cache reads/writes, and Nifty 500 CSV parsing into `scripts/lib/market-data.mjs`.

- [ ] **Step 3: Keep existing script compatible**

Update `scripts/supertrend-research.mjs` to import helpers or leave it untouched if lower risk; the new rolling script can use the modules directly.

### Task 3: Rolling Research CLI

**Files:**
- Create: `scripts/rolling-supertrend-research.mjs`

- [ ] **Step 1: Load universe**

Load mandatory symbols, fresh-momentum seeds, and Nifty 500 symbols. Fetch/cache daily Yahoo candles.

- [ ] **Step 2: Compute indicators**

Compute 21/50/100/200/250 DMA, ATR, and Supertrend causally for each symbol.

- [ ] **Step 3: Run rolling paths**

For every eligible anchor date, run R1/R2/R3 over 21/42/63/126 trading-day horizons and both exit modes.

- [ ] **Step 4: Write reports**

Write JSON and CSV outputs under `data/supertrend-research/rolling-report.json` and `.csv`.

### Task 4: Verification

**Files:**
- Use: `tests/rolling-simulator.test.mjs`
- Use: `scripts/rolling-supertrend-research.mjs`

- [ ] **Step 1: Run unit tests**

Run: `node --test tests/rolling-simulator.test.mjs`

- [ ] **Step 2: Run rolling research script**

Run: `node scripts/rolling-supertrend-research.mjs`

- [ ] **Step 3: Inspect output**

Confirm report contains the selected stock universe, strategy summaries, current setup table, and both exit fill modes.
