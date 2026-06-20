#!/usr/bin/env python3
"""
Fetch market cap for every symbol in nse_universe.json via yfinance.
Appends .NS suffix, calls ticker.info, writes results to data/market_caps.json.

Usage:
    python3 scripts/fetch-market-caps.py

Output:
    data/market_caps.json  — { "SYMBOL": <marketCap_INR|null>, ... }
    Prints tier summary at the end.
"""

import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import warnings
warnings.filterwarnings("ignore")

import yfinance as yf

UNIVERSE_PATH = os.path.join(os.path.dirname(__file__), "../data/nse_universe.json")
OUTPUT_PATH   = os.path.join(os.path.dirname(__file__), "../data/market_caps.json")
WORKERS       = 20   # parallel threads — yfinance handles concurrency fine at this level
CRORE         = 1e7  # 1 crore = 10,000,000 INR

def fetch_one(symbol):
    try:
        info = yf.Ticker(f"{symbol}.NS").info
        mc = info.get("marketCap")
        return symbol, mc  # INR for .NS tickers
    except Exception:
        return symbol, None

def main():
    with open(UNIVERSE_PATH) as f:
        universe = json.load(f)
    symbols = [s["symbol"] for s in universe]

    # Resume: skip symbols already fetched
    existing = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            existing = json.load(f)
        symbols = [s for s in symbols if s not in existing]
        print(f"Resuming: {len(existing)} done, {len(symbols)} remaining")

    results = dict(existing)
    done = len(existing)
    total = done + len(symbols)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_one, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            sym, mc = fut.result()
            results[sym] = mc
            done += 1
            if done % 50 == 0 or done == total:
                # Save checkpoint after every 50
                with open(OUTPUT_PATH, "w") as f:
                    json.dump(results, f)
                pct = done / total * 100
                fetched = sum(1 for v in results.values() if v is not None)
                print(f"  [{done}/{total} {pct:.0f}%] fetched={fetched}", flush=True)

    # Final save
    with open(OUTPUT_PATH, "w") as f:
        json.dump(results, f, indent=2)

    # Summary
    with_data  = {k: v for k, v in results.items() if v is not None and v > 0}
    lt_100cr   = {k: v for k, v in with_data.items() if v < 100 * CRORE}
    lt_200cr   = {k: v for k, v in with_data.items() if v < 200 * CRORE}
    lt_500cr   = {k: v for k, v in with_data.items() if v < 500 * CRORE}
    lt_1000cr  = {k: v for k, v in with_data.items() if v < 1000 * CRORE}
    no_data    = {k for k, v in results.items() if v is None or v == 0}

    print(f"\n{'='*50}")
    print(f"Total symbols queried : {total}")
    print(f"Got market cap data   : {len(with_data)}")
    print(f"No data (null/0)      : {len(no_data)}")
    print(f"\nMarket cap tiers (INR crore):")
    print(f"  < 100 crore  : {len(lt_100cr):>5} stocks")
    print(f"  < 200 crore  : {len(lt_200cr):>5} stocks")
    print(f"  < 500 crore  : {len(lt_500cr):>5} stocks")
    print(f"  < 1000 crore : {len(lt_1000cr):>5} stocks")
    print(f"  ≥ 1000 crore : {len(with_data) - len(lt_1000cr):>5} stocks")
    print(f"\nSmallest 10 (< 100cr):")
    for sym, mc in sorted(lt_100cr.items(), key=lambda x: x[1])[:10]:
        print(f"  {sym:<20} {mc/CRORE:>8.1f} cr")

if __name__ == "__main__":
    main()
