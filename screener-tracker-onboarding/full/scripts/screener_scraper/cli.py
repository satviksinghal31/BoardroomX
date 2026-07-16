"""Command line entrypoint for the Screener scraper."""

from __future__ import annotations

import argparse
import csv
import getpass
import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Type

from .client import ScraperConfig, ScreenerScraper
from .parsers import SECTION_ALIASES, canonical_section, sanitize_ticker

log = logging.getLogger("screener_scraper")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )


def _available_section_names() -> List[str]:
    return sorted(set(SECTION_ALIASES.values()))


def _read_tickers(path: Path) -> List[str]:
    raw = path.read_text(encoding="utf-8-sig")
    values: List[str] = []
    if path.suffix.lower() == ".csv":
        rows = list(csv.reader(raw.splitlines()))
        if not rows:
            return []
        headers = [cell.strip().lower() for cell in rows[0]]
        ticker_index = 0
        for candidate in ("ticker", "symbol", "scrip"):
            if candidate in headers:
                ticker_index = headers.index(candidate)
                break
        for row in rows[1:]:
            if len(row) > ticker_index:
                values.append(row[ticker_index])
    else:
        for line in raw.splitlines():
            value = line.split("#", 1)[0].strip()
            if value:
                values.append(value.split(",", 1)[0])
    seen = set()
    tickers: List[str] = []
    for value in values:
        ticker = sanitize_ticker(value)
        if ticker not in seen:
            seen.add(ticker)
            tickers.append(ticker)
    return tickers


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        tmp_path.replace(path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _summarize_item(ticker: str, path: Path, data: Dict[str, Any], error: Optional[str] = None) -> Dict[str, Any]:
    statuses = data.get("section_status") or {}
    unavailable = [
        name for name, status in statuses.items()
        if isinstance(status, dict) and status.get("status") != "ok"
    ]
    return {
        "ticker": ticker,
        "ok": error is None,
        "out_file": str(path),
        "statement_type": data.get("statement_type"),
        "latest_profit_loss_period": (data.get("profit_loss", {}).get("years") or [None])[-1],
        "unavailable_sections": unavailable,
        "error": error,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape Screener.in company data.")
    parser.add_argument("--ticker", help="Single ticker slug, e.g. TDPOWERSYS")
    parser.add_argument("--batch", help="Path to newline file or CSV containing tickers")
    parser.add_argument("--statement", default="consolidated", choices=("consolidated", "standalone"))
    parser.add_argument("--out-dir", default="outputs/screener")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--user", default=os.environ.get("SCREENER_USER"))
    parser.add_argument("--password", default=os.environ.get("SCREENER_PASS"))
    parser.add_argument("--prompt-password", action="store_true")
    parser.add_argument("--sections", nargs="+")
    parser.add_argument("--list-sections", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def main(argv: Optional[Sequence[str]] = None, scraper_factory: Type[ScreenerScraper] = ScreenerScraper) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)

    if args.list_sections and not args.ticker and not args.batch:
        for section in _available_section_names():
            print(section)
        return 0

    if bool(args.ticker) == bool(args.batch):
        parser.error("provide exactly one of --ticker or --batch")

    tickers = [sanitize_ticker(args.ticker)] if args.ticker else _read_tickers(Path(args.batch))
    sections = [canonical_section(section) for section in args.sections] if args.sections else None
    password = getpass.getpass("Screener password: ") if args.prompt_password else args.password
    out_dir = Path(args.out_dir)
    config = ScraperConfig(delay=args.delay, out_dir=out_dir, sections=sections)
    summary_items: List[Dict[str, Any]] = []

    with scraper_factory(username=args.user, password=password, config=config) as scraper:
        if args.list_sections:
            for section in _available_section_names():
                print(section)
            return 0

        for index, ticker in enumerate(tickers, start=1):
            out_path = out_dir / ("%s_%s.json" % (ticker, args.statement))
            log.info("[%s/%s] scraping %s", index, len(tickers), ticker)
            try:
                data = scraper.scrape_company(ticker, statement=args.statement, sections=sections)
                _write_json(out_path, data)
                summary_items.append(_summarize_item(ticker, out_path, data))
            except Exception as exc:
                error = "%s: %s" % (type(exc).__name__, exc)
                log.exception("failed to scrape %s", ticker)
                payload = {"ticker": ticker, "statement_type": args.statement, "error": error}
                _write_json(out_path, payload)
                summary_items.append(_summarize_item(ticker, out_path, payload, error=error))

    summary = {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "statement": args.statement,
        "total": len(summary_items),
        "succeeded": sum(1 for item in summary_items if item["ok"]),
        "failed": sum(1 for item in summary_items if not item["ok"]),
        "items": summary_items,
    }
    _write_json(out_dir / "_scrape_summary.json", summary)
    return 0 if summary["failed"] == 0 else 1
