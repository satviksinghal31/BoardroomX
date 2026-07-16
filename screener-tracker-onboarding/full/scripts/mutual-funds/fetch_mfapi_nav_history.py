#!/usr/bin/env python3
"""Fetch and normalize full MFAPI NAV history for the approved fund universe."""

from __future__ import annotations

import hashlib
import json
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UNIVERSE_PATH = ROOT / "data" / "mutual-funds" / "fund-universe.json"
PRIVATE_DIR = ROOT / "data" / "mutual-funds" / "nav-history"
PUBLIC_DIR = ROOT / "public" / "data" / "mutual-funds" / "nav-history"
MFAPI_BASE_URL = "https://api.mfapi.in/mf"


def parse_mfapi_date(value: str) -> str:
    return datetime.strptime(value, "%d-%m-%Y").date().isoformat()


def parse_nav(value: str) -> float:
    return float(value.strip())


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fetch_json(url: str) -> tuple[dict, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "BoardroomX-MFAPI-NAV/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw), raw


def normalize_history(instrument: dict, payload: dict, raw_payload: str) -> dict:
    meta = payload.get("meta", {})
    status = payload.get("status")
    scheme_code = str(meta.get("scheme_code"))
    expected_code = str(instrument["mfapi_scheme_code"])
    if status != "SUCCESS":
        raise ValueError(f"{instrument['fund_key']} MFAPI status is {status!r}")
    if scheme_code != expected_code:
        raise ValueError(f"{instrument['fund_key']} scheme code mismatch: expected {expected_code}, got {scheme_code}")
    if not isinstance(payload.get("data"), list) or not payload["data"]:
        raise ValueError(f"{instrument['fund_key']} has no NAV rows")

    by_date: dict[str, dict] = {}
    duplicate_dates = 0
    for row in payload["data"]:
        iso_date = parse_mfapi_date(str(row["date"]))
        nav_raw = str(row["nav"]).strip()
        nav = parse_nav(nav_raw)
        if nav <= 0:
            raise ValueError(f"{instrument['fund_key']} has non-positive NAV on {iso_date}")
        if iso_date in by_date:
            duplicate_dates += 1
        by_date[iso_date] = {"date": iso_date, "nav": nav, "nav_raw": nav_raw}

    nav_history = [by_date[date] for date in sorted(by_date)]
    first_date = nav_history[0]["date"]
    latest_date = nav_history[-1]["date"]
    source_url = f"{MFAPI_BASE_URL}/{expected_code}"
    record = {
        "schema_version": "1.0",
        "source": {
            "provider": "MFAPI",
            "url": source_url,
            "status": status,
            "raw_sha256": sha256_text(raw_payload),
            "source_data_as_of": latest_date,
        },
        "identity": {
            "fund_key": instrument["fund_key"],
            "display_name": instrument["display_name"],
            "role": instrument["role"],
            "amc": instrument["amc"],
            "plan": instrument["plan"],
            "option": instrument["option"],
            "mfapi_scheme_code": expected_code,
            "mfapi_scheme_name": meta.get("scheme_name"),
            "mfapi_fund_house": meta.get("fund_house"),
            "mfapi_scheme_type": meta.get("scheme_type"),
            "mfapi_scheme_category": meta.get("scheme_category"),
            "isin_growth": meta.get("isin_growth"),
        },
        "nav_history": nav_history,
        "quality": {
            "row_count": len(nav_history),
            "first_nav_date": first_date,
            "latest_nav_date": latest_date,
            "duplicate_dates": duplicate_dates,
            "sorted_ascending": nav_history == sorted(nav_history, key=lambda item: item["date"]),
        },
    }
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":"))
    record["source"]["canonical_sha256"] = sha256_text(canonical)
    return record


def summary_row(record: dict) -> dict:
    return {
        "fund_key": record["identity"]["fund_key"],
        "display_name": record["identity"]["display_name"],
        "role": record["identity"]["role"],
        "mfapi_scheme_code": record["identity"]["mfapi_scheme_code"],
        "mfapi_scheme_name": record["identity"]["mfapi_scheme_name"],
        "status": record["source"]["status"],
        "first_nav_date": record["quality"]["first_nav_date"],
        "latest_nav_date": record["quality"]["latest_nav_date"],
        "nav_count": record["quality"]["row_count"],
        "duplicate_dates": record["quality"]["duplicate_dates"],
        "source_url": record["source"]["url"],
        "canonical_sha256": record["source"]["canonical_sha256"],
    }


def main() -> None:
    universe = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    records = []
    for instrument in universe["instruments"]:
        url = f"{MFAPI_BASE_URL}/{instrument['mfapi_scheme_code']}"
        payload, raw_payload = fetch_json(url)
        record = normalize_history(instrument, payload, raw_payload)
        records.append(record)
        private_path = PRIVATE_DIR / f"{instrument['fund_key']}.json"
        public_path = PUBLIC_DIR / f"{instrument['fund_key']}.json"
        serialized = json.dumps(record, indent=2) + "\n"
        private_path.write_text(serialized, encoding="utf-8")
        public_path.write_text(serialized, encoding="utf-8")
        print(f"Wrote {private_path.relative_to(ROOT)} ({record['quality']['row_count']} rows)")

    latest_dates = [record["quality"]["latest_nav_date"] for record in records]
    summary = {
        "schema_version": "1.0",
        "provider": "MFAPI",
        "source_base_url": MFAPI_BASE_URL,
        "source_data_as_of": max(latest_dates),
        "funds": [summary_row(record) for record in records],
    }
    summary_text = json.dumps(summary, indent=2) + "\n"
    (PRIVATE_DIR / "nav-history-summary.json").write_text(summary_text, encoding="utf-8")
    (PUBLIC_DIR / "nav-history-summary.json").write_text(summary_text, encoding="utf-8")
    print(f"Wrote {(PRIVATE_DIR / 'nav-history-summary.json').relative_to(ROOT)}")
    print(f"Wrote {(PUBLIC_DIR / 'nav-history-summary.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
