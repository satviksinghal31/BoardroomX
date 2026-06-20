#!/usr/bin/env python3
"""
Fetch upcoming & past result dates from NSE API (BennyThadikaran/NseIndiaApi).
Updates expected_at (upcoming board meeting) and reported_at (past results) in
the Supabase `results` table.

Run: python3 fetch_ann.py [SYMBOL ...]
     python3 fetch_ann.py            ← all portfolio stocks
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip3 install requests")
    sys.exit(1)

try:
    from nse import NSE
except ImportError:
    print("ERROR: nse not installed. Run: pip3 install nse")
    sys.exit(1)

BASE      = Path(__file__).parent
PORTFOLIO = json.loads((BASE / "portfolio.json").read_text())

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# ── Helpers ────────────────────────────────────────────────────────────────

def nse_symbol(company):
    """NSE API symbol = yahooSymbol if overridden, else portfolio symbol."""
    return company.get("yahooSymbol", company["symbol"])


def parse_bm_date(s):
    """Parse NSE board meeting date string e.g. '26-May-2026' → datetime."""
    try:
        return datetime.strptime(s, "%d-%b-%Y")
    except Exception:
        return None


def board_date_to_quarter(dt):
    """Derive the quarter being declared from board meeting date.
    Apr–Jun → Mar <year>, Jul–Sep → Jun <year>,
    Oct–Dec → Sep <year>,  Jan–Mar → Dec <year-1>
    """
    m, y = dt.month, dt.year
    if   m in (4, 5, 6):    return f"Mar {y}"
    elif m in (7, 8, 9):    return f"Jun {y}"
    elif m in (10, 11, 12): return f"Sep {y}"
    else:                   return f"Dec {y - 1}"


def is_financial_result(purpose_or_desc):
    s = (purpose_or_desc or "").lower()
    return "financial result" in s or "financial results" in s


# ── NSE fetch ──────────────────────────────────────────────────────────────

def fetch_board_meetings(nse, nsesym):
    """Return list of {date, quarter, is_upcoming} for financial result meetings."""
    try:
        bms = nse.boardMeetings(symbol=nsesym)
    except Exception as e:
        print(f"  boardMeetings({nsesym}) error: {e}")
        return []

    today = datetime.today()
    meetings = []
    seen_quarters = set()

    for b in bms:
        purpose = b.get("bm_purpose", "")
        desc    = b.get("bm_desc", "")
        if not (is_financial_result(purpose) or is_financial_result(desc)):
            continue
        dt = parse_bm_date(b.get("bm_date", ""))
        if not dt:
            continue
        quarter = board_date_to_quarter(dt)
        if quarter in seen_quarters:
            continue
        seen_quarters.add(quarter)
        meetings.append({
            "date":        dt.strftime("%Y-%m-%d"),
            "quarter":     quarter,
            "is_upcoming": dt.date() >= today.date(),
        })

    return meetings


# ── Supabase write ─────────────────────────────────────────────────────────

def sb_headers():
    return {
        "apikey":        SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type":  "application/json",
    }


def upsert_result_date(symbol, quarter, expected_at=None, reported_at=None):
    if not SUPABASE_URL or not SERVICE_KEY:
        print(f"  WARNING: SUPABASE env vars missing — skipping DB write")
        return

    payload = {"symbol": symbol, "quarter": quarter}
    if expected_at:
        payload["expected_at"] = expected_at
    if reported_at:
        payload["reported_at"] = reported_at

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/results",
        params={"on_conflict": "symbol,quarter"},
        headers={**sb_headers(), "Prefer": "resolution=merge-duplicates"},
        json=payload,
        timeout=10,
    )
    if r.status_code not in (200, 201, 204):
        print(f"  [{symbol}] upsert error {r.status_code}: {r.text}")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    filter_symbols = {s.upper() for s in sys.argv[1:]}
    targets = [c for c in PORTFOLIO if not filter_symbols or c["symbol"] in filter_symbols]
    if not targets:
        print("No matching companies"); sys.exit(1)

    nse = NSE(download_folder="/tmp/nse_fetch_ann", timeout=30)

    try:
        print(f"Processing {len(targets)} stock(s)...\n")
        for company in targets:
            symbol = company["symbol"]
            nsesym = nse_symbol(company)
            print(f"[{symbol}] (NSE: {nsesym})")

            meetings = fetch_board_meetings(nse, nsesym)

            if not meetings:
                print(f"  no financial result board meetings found")
                continue

            for m in meetings:
                field = "expected_at" if m["is_upcoming"] else "reported_at"
                tag   = ">>" if m["is_upcoming"] else "ok"
                print(f"  [{tag}] {m['quarter']} -> {field} = {m['date']}")
                upsert_result_date(
                    symbol,
                    m["quarter"],
                    expected_at = m["date"] if m["is_upcoming"] else None,
                    reported_at = m["date"] if not m["is_upcoming"] else None,
                )

            time.sleep(0.3)

    finally:
        nse.exit()

    print("\nDone.")


if __name__ == "__main__":
    main()
