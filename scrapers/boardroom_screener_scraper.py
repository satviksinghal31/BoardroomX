#!/usr/bin/env python3
"""Fetch one Screener.in company as JSON (Python 3.9+, no browser required).

    pip install requests beautifulsoup4
    python boardroom_screener_scraper.py RELIANCE --out out
    python boardroom_screener_scraper.py 531494 --out out

Auto selects usable consolidated financials, otherwise standalone; never merges
views. Fetches the company page and, only if needed, its peers table. Expanded
financial breakdowns, named shareholders, charts, pros/cons, login/premium features
and attachment downloads are excluded. Optional failures are recorded in warnings.

Library: fetch_company("RELIANCE") or scrape(existing_session, "RELIANCE").
Financial tables use one node per displayed period, including TTM where present.
Units are explicit per field; percent values are percentage points (18%, not .18).
"""
from __future__ import annotations

import argparse
import calendar
import json
import math
import os
import tempfile
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlencode, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.screener.in"
UA = "Mozilla/5.0 (compatible; boardroom-screener-scraper/3.0; personal research)"
PARSER_VERSION = "3.0.0"
MAX_RETRY_WAIT = 60
MONTHS = {m: i for i, m in enumerate(calendar.month_abbr) if m}

# Top-box ratios get explicit unit-bearing names; anything else falls back to snake_case.
KEY_RATIO_NAMES = {
    "Market Cap": "market_cap_cr", "Current Price": "price", "Stock P/E": "pe",
    "Book Value": "book_value", "Dividend Yield": "dividend_yield_pct",
    "ROCE": "roce_pct", "ROE": "roe_pct", "Face Value": "face_value",
}


# --------------------------------------------------------------------------- parsing helpers
def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def label(s: str | None) -> str:
    """Row/column label: drop the '+' expander mark and a trailing colon."""
    return re.sub(r":$", "", re.sub(r"\s*\+\s*$", "", clean(s))).strip()


def num(s: str | None) -> float | int | None:
    """'1,234' -> 1234, '12.5%' -> 12.5, '-' / '' / 'x,xxx' (locked) -> None."""
    s = re.sub(r"[,₹%\s]", "", clean(s)).rstrip("+")
    if not s or s == "-" or re.fullmatch(r"x+(\.x+)?", s, re.I):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    if not math.isfinite(f):
        return None
    return int(f) if f.is_integer() and "." not in s else f


def snake(s: str) -> str:
    s = clean(s).lower().replace("%", " pct ").replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def period_end(period: str) -> str | None:
    """'Mar 2024' -> '2024-03-31'. 'TTM' and anything else -> None."""
    m = re.fullmatch(r"([A-Z][a-z]{2}) (\d{4})", period)
    if not m or m.group(1) not in MONTHS:
        return None
    y, mo = int(m.group(2)), MONTHS[m.group(1)]
    if y < 1:
        return None
    return f"{y:04d}-{mo:02d}-{calendar.monthrange(y, mo)[1]:02d}"


def cells(tr):
    return tr.find_all(["th", "td"], recursive=False)


def metric_unit(name: str, section: str, amount_unit: str = "INR crore") -> str:
    key = snake(name)
    if "shareholder" in key:
        return "count"
    if "%" in name or key.endswith("_pct") or section in ("quarterly-shp", "yearly-shp"):
        return "percent"
    if key in ("eps", "eps_in_rs", "basic_eps", "diluted_eps", "price", "book_value", "face_value", "high", "low", "cmp_rs"):
        return "INR/share"
    if "days" in key or key == "cash_conversion_cycle":
        return "days"
    if section == "ratios":
        return "unknown"  # Never guess the unit of an unfamiliar ratio.
    return amount_unit


def period_nodes(table, source_url: str = BASE, warnings=None) -> list[dict] | None:
    """Pivot periods without dropping result-source links or missing cells."""
    if table is None:
        return None
    rows = table.find_all("tr")
    if not rows or len(cells(rows[0])) < 2:
        return None
    periods = [label(c.get_text()) for c in cells(rows[0])[1:]]
    nodes = [{"period": p, "period_end": period_end(p)} for p in periods]
    if warnings is not None:
        warnings.extend(f"Unrecognized table period: {p}" for p in periods if p != "TTM" and period_end(p) is None)
    for tr in rows[1:]:
        c = cells(tr)
        name = label(c[0].get_text()) if c else ""
        if not name:
            continue
        if len(c) - 1 != len(nodes) and warnings is not None:
            warnings.append(f"Table width mismatch for {name}: {len(c)-1} cells, {len(nodes)} periods")
        for i, node in enumerate(nodes):
            cell = c[i + 1] if i + 1 < len(c) else None
            if name == "Raw PDF":
                link = cell.find("a", href=True) if cell else None
                node["raw_pdf_url"] = urljoin(source_url, link["href"]) if link else None
            else:
                node[snake(name)] = num(cell.get_text() if cell else None)
    return nodes


def table_units(table, section: str) -> dict:
    if table is None:
        return {}
    root = table.find_parent("section")
    description = root.select_one("p") if root else None
    amount = "INR lakh" if description and "lakh" in description.get_text().lower() else "INR crore"
    out = {}
    for row in table.find_all("tr")[1:]:
        c = cells(row)
        name = label(c[0].get_text()) if c else ""
        if name and name != "Raw PDF":
            out[snake(name)] = metric_unit(name, section, amount)
    return out


# --------------------------------------------------------------------------- page parsing
def key_ratios(soup) -> dict:
    out = {}
    for li in soup.select("#top li"):
        name_el, val_el = li.select_one(".name"), li.select_one(".value")
        name = label(name_el.get_text() if name_el else "")
        if not name or val_el is None:
            continue
        text = clean(val_el.get_text())
        nums = [num(part) for part in text.replace("Cr.", "").split("/")]
        if name == "High / Low":
            out["high"], out["low"] = (nums + [None, None])[:2]
        else:
            out[KEY_RATIO_NAMES.get(name, snake(name))] = nums[0] if len(nums) == 1 else None
    return out


def profile(soup, source_url: str = BASE) -> dict:
    about = soup.select_one(".company-profile .about")
    points = soup.select_one(".company-profile .commentary")
    references = {}
    for key, root in (("about", about), ("key_points", points)):
        references[key] = [{"title": clean(a.get_text()), "url": urljoin(source_url, a["href"])}
                           for a in root.select("a[href]")] if root else []
        if root:
            for junk in root.select("sup, .show-more-button, button"):
                junk.decompose()
    links = {clean(a.get_text()): urljoin(source_url, a["href"]) for a in soup.select("#top a[href]")}
    bse = next((re.sub(r"^BSE:\s*", "", t) for t in links if t.startswith("BSE:")), None)
    nse = next((re.sub(r"^NSE:\s*", "", t) for t in links if t.startswith("NSE:")), None)
    classification, indices = {}, []
    peers = soup.select_one("#peers")
    if peers:
        classification = {snake(a["title"]): label(a.get_text()) for a in peers.select("p.sub a[title]")}
        indices = [label(a.get_text()) for a in peers.select('a[href^="/company/"]') if not a.find_parent("table")]
    more = soup.select_one('button[data-url*="/commentary/"]')
    return {
        "about": clean(about.get_text(" ")) if about else None,
        "key_points": clean(points.get_text(" ")) if points else None,
        "key_points_is_preview": more is not None,
        "key_points_url": urljoin(source_url, more["data-url"]) if more else None,
        "references": references,
        "website": links.get("Website") or next((h for h in links.values() if urlparse(h).scheme in ("http", "https")
                    and not re.search(r"bseindia|nseindia|screener\.in", urlparse(h).netloc)), None),
        "bse_code": bse, "nse_code": nse, "classification": classification, "indices": indices,
    }


def growth_tables(root, warnings=None) -> dict:
    out = {}
    for t in root.select("table.ranges-table") if root is not None else []:
        rows = t.find_all("tr")
        if not rows:
            continue
        group = out.setdefault(snake(rows[0].get_text()), {})
        for row in rows[1:]:
            c = cells(row)
            if not c:
                continue
            group[snake(label(c[0].get_text()))] = num(c[1].get_text()) if len(c) > 1 else None
            if len(c) != 2 and warnings is not None:
                warnings.append("Malformed growth table row; missing value retained as null")
    return out


def peers_table(html: str | None, classification: dict | None = None) -> dict | None:
    if not html:
        return None
    table = BeautifulSoup(html, PARSER).find("table")
    if table is None:
        return None
    rows = table.find_all("tr")
    if not rows or len(cells(rows[0])) < 2:
        return None
    columns = [snake(c.get_text()) for c in cells(rows[0])]
    out_rows, median = [], None
    for tr in rows[1:]:
        c = cells(tr)
        if len(c) != len(columns):
            continue
        link = c[1].find("a")
        values = {k: num(x.get_text()) for k, x in zip(columns[2:], c[2:])}
        if link is not None:
            m = re.match(r"/company/([^/]+)/", link.get("href", ""))
            out_rows.append({"rank": int(num(c[0].get_text()) or 0) or None, "name": label(link.get_text()),
                             "symbol": m.group(1) if m else None, **values})
        elif clean(c[1].get_text()).startswith("Median"):
            median = {"label": clean(c[1].get_text()), **values}
    return {"columns": columns[2:], "peers": out_rows, "median": median}


def documents(soup, source_url: str = BASE) -> dict:
    out = {}
    for box in soup.select("#documents .documents"):
        heading = box.find("h3")
        if heading is None:
            continue
        section, items = snake(heading.get_text()), []
        for li in box.select("ul.list-links li"):
            anchors = li.select("a[href]")
            if not anchors:
                continue
            a = anchors[0]
            links = [{"type": clean(x.get_text()) or x.get("title") or "document",
                      "url": urljoin(source_url, x["href"])} for x in anchors]
            when, note = li.find("time"), a.find("div")
            source = None
            source_text = clean(li.get_text(" "))
            match = re.search(r"\bfrom\s+(\w+)", source_text, re.I)
            if match:
                source = match.group(1).lower()
            date_text = clean(when.get_text()) if when else None
            if section == "credit_ratings" and note:
                date_text = re.split(r"\s+from\s+", clean(note.get_text()), maxsplit=1, flags=re.I)[0]
            period = None
            if section == "concalls":
                month = li.find("div", recursive=False)
                period = clean(month.get_text()) if month else None
                date_text = period
            item = {"title": clean(a.find(string=True, recursive=False)) or label(a.get_text()),
                    "date": when.get("datetime") if when else None,
                    "date_text": date_text, "source": source,
                    "detail": clean(note.get_text()).split(" - ", 1)[-1] if note else None,
                    "url": urljoin(source_url, a["href"]), "links": links}
            if section == "concalls":
                item.update(period=period, period_end=period_end(period or ""))
            if section == "annual_reports":
                year = re.search(r"\b(\d{4})\b", item["title"])
                item["year"] = int(year.group(1)) if year else None
            items.append(item)
        out[section] = items
    return out


def parse_company(html: str, peers_html: str | None = None, source_url: str = BASE) -> dict:
    """Pure page parser; no network calls. Numeric fields preserve existing names."""
    soup = BeautifulSoup(html, PARSER)
    h1, info = soup.select_one("#top h1"), soup.select_one("#company-info")
    warnings, units, tables = [], {}, {}
    mapping = {"quarters": "quarterly_results", "profit-loss": "profit_loss", "balance-sheet": "balance_sheet",
               "cash-flow": "cash_flow", "ratios": "ratios", "quarterly-shp": "quarterly", "yearly-shp": "yearly"}
    for section, key in mapping.items():
        table = soup.select_one(f"#{section} table")
        tables[key] = period_nodes(table, source_url, warnings)
        units[key] = table_units(table, section)
    pl = soup.select_one("#profit-loss")
    units["profit_loss"] = {"annual": units["profit_loss"], "growth": "percent"}
    units["shareholding"] = {"quarterly": units.pop("quarterly"), "yearly": units.pop("yearly")}
    ratios = key_ratios(soup)
    units["key_ratios"] = {k: ("INR crore" if k == "market_cap_cr" else "multiple" if k == "pe"
                              else metric_unit(k, "top", "unknown")) for k in ratios}
    features = []
    for button in soup.select("button[onclick]"):
        call = button.get("onclick", "")
        if button.get("data-url"):
            features.append({"name": clean(button.get_text()), "url": urljoin(source_url, button["data-url"]),
                             "status": "not_requested"})
    tab = soup.select_one('#company-announcements-tab a[href]')
    annual = tables["profit_loss"] or []
    dates = [n["period_end"] for n in annual if n["period_end"]]
    actual_view = "consolidated" if info and info.get("data-consolidated", "").lower() == "true" else None
    if not actual_view:
        heading = pl.select_one("p") if pl else None
        if heading and "Consolidated" in heading.get_text():
            actual_view = "consolidated"
        elif info or heading:
            actual_view = "standalone"
    return {
        "name": clean(h1.get_text()) if h1 else None,
        "company_id": info.get("data-company-id") if info else None,
        "warehouse_id": info.get("data-warehouse-id") if info else None,
        "profile": profile(soup, source_url), "key_ratios": ratios,
        "quarterly_results": tables["quarterly_results"],
        "profit_loss": {"annual": tables["profit_loss"], "growth": growth_tables(pl, warnings)},
        "balance_sheet": tables["balance_sheet"], "cash_flow": tables["cash_flow"], "ratios": tables["ratios"],
        "shareholding": {"quarterly": tables["quarterly"], "yearly": tables["yearly"]},
        "peers": peers_table(peers_html if peers_html is not None else str(soup.select_one("#peers table") or "")), "documents": documents(soup, source_url),
        "document_scope": {"announcements": "recent", "all_announcements_url": urljoin(source_url, tab["href"]) if tab else None},
        "history": {"annual_period_count": len(dates), "first_period_end": min(dates) if dates else None,
                    "latest_period_end": max(dates) if dates else None, "includes_ttm": any(n["period"] == "TTM" for n in annual)},
        "units": units, "warnings": warnings, "other_features": features,
        "_view": actual_view,
    }


def has_financials(company: dict) -> bool:
    measurements = {"sales", "revenue", "net_profit", "profit_before_tax", "operating_profit", "financing_profit"}
    return any((row.get("period_end") is not None or row.get("period") == "TTM")
               and any(isinstance(row.get(k), (int, float)) for k in measurements)
               for row in (company.get("profit_loss") or {}).get("annual") or [])


# --------------------------------------------------------------------------- network
PARSER = "lxml"
try:
    import lxml  # noqa: F401
except ImportError:  # lxml is optional; the stdlib parser gives the same result
    PARSER = "html.parser"


class ScrapeError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class NotFound(ScrapeError):
    pass


class Client:
    """One session, sequential paced requests, bounded retries; no global state."""
    def __init__(self, session, pause: float):
        self.session, self.pause, self.last_request = session, pause, None
        self.optional_blocked = False

    def get(self, url: str, retries: int = 2):
        for attempt in range(retries + 1):
            if self.last_request is not None:
                wait = self.pause - (time.monotonic() - self.last_request)
                if wait > 0:
                    time.sleep(wait)
            self.last_request = time.monotonic()
            try:
                r = self.session.get(url, timeout=30)
            except requests.RequestException as exc:
                if attempt == retries:
                    raise ScrapeError(f"Network error for {url}: {exc}") from exc
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 404:
                raise NotFound(f"HTTP 404 for {url}", 404)
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt == retries:
                    raise ScrapeError(f"HTTP {r.status_code} for {url}", r.status_code)
                retry = r.headers.get("Retry-After", "")
                wait = 2 ** (attempt + 1)
                if retry.isdigit():
                    wait = int(retry)
                elif retry:
                    try:
                        dt = parsedate_to_datetime(retry)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        wait = max(0, (dt - datetime.now(timezone.utc)).total_seconds())
                    except (ValueError, TypeError, OverflowError):
                        pass
                if wait > MAX_RETRY_WAIT:
                    raise ScrapeError(f"HTTP {r.status_code}: Retry-After {wait:g}s exceeds this call budget; retry later", r.status_code)
                time.sleep(wait)
                continue
            try:
                r.raise_for_status()
            except requests.RequestException as exc:
                raise ScrapeError(f"HTTP {r.status_code} for {url}", r.status_code) from exc
            return r
        raise ScrapeError(f"Request failed for {url}")

    def optional(self, url: str, warnings: list):
        if self.optional_blocked:
            warnings.append(f"Skipped optional endpoint after upstream failure: {url}")
            return None
        try:
            r = self.get(url)
            if any(path in urlparse(r.url).path for path in ("/register/", "/login/")):
                raise ScrapeError(f"Login required for {url}", 401)
            return r
        except ScrapeError as exc:
            warnings.append(str(exc))
            if exc.status is None or exc.status in (401, 403, 429) or exc.status >= 500:
                self.optional_blocked = True
            return None


def scrape(session: requests.Session, symbol: str, view: str = "auto", pause: float = 0.0) -> dict:
    """Fetch exactly one company; auto stops at the first usable accounting view.

    Operational errors (403, exhausted 429/5xx, network failures) are not evidence
    consolidated is absent and therefore do not trigger a standalone fetch.
    """
    symbol = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9&._-]*", symbol):
        raise ValueError("Use a Screener company symbol or numeric BSE code, not a URL/path")
    if view not in ("auto", "consolidated", "standalone"):
        raise ValueError("view must be auto, consolidated or standalone")
    if not math.isfinite(pause) or pause < 0:
        raise ValueError("pause must be a finite nonnegative number")
    client = Client(session, pause)
    encoded = quote(symbol, safe='')
    choices = ["consolidated", "standalone"] if view == "auto" else [view]
    fallback_reason = None
    for requested_view in choices:
        url = f"{BASE}/company/{encoded}/" + ("consolidated/" if requested_view == "consolidated" else "")
        try:
            response = client.get(url)
        except NotFound:
            fallback_reason = "consolidated_not_found"
            continue
        if any(path in urlparse(response.url).path for path in ("/register/", "/login/")):
            raise ScrapeError("Company page requires login", 401)
        company = parse_company(response.text, source_url=response.url)
        if not company["name"] or not company["company_id"]:
            raise ScrapeError(f"Unexpected company-page response for {response.url}; financial availability is unknown")
        if not has_financials(company):
            fallback_reason = "consolidated_has_no_usable_financials"
            continue
        actual_view = company.pop("_view") or ("consolidated" if "/consolidated/" in urlparse(response.url).path else "standalone")
        if view != "auto" and actual_view != view:
            raise NotFound(f"Requested {view} view is unavailable; response is {actual_view}")
        wid = company["warehouse_id"]
        if wid and company["peers"] is None:
            peer_url = f"{BASE}/api/company/{quote(wid, safe='')}/peers/"
            peer_response = client.optional(peer_url, company["warnings"])
            company["peers"] = peers_table(peer_response.text) if peer_response is not None else None
            if peer_response is not None and company["peers"] is None:
                company["warnings"].append("Peers endpoint did not return a usable table")
        elif not wid and company["peers"] is None:
            company["warnings"].append("Warehouse ID missing; peers unavailable")
        if company["peers"]:
            company["units"]["peers"] = {key: "percent" if key.endswith("_pct") else "multiple" if key == "p_e"
                                         else "INR/share" if key == "cmp_rs" else "INR crore" if "rs_cr" in key else "unknown"
                                         for key in company["peers"]["columns"]}
        company["history"]["short_history"] = company["history"]["annual_period_count"] < 5
        if company["history"]["short_history"]:
            company["warnings"].append("Fewer than five annual periods in selected view; accounting views were not mixed")
        return {"symbol": company["profile"]["nse_code"] or company["profile"]["bse_code"] or symbol,
                "requested_identifier": symbol, "view": actual_view, "source_url": response.url,
                "requested_url": url, "fallback_reason": fallback_reason if actual_view == "standalone" else None,
                "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "parser_version": PARSER_VERSION, "scope": "company_page_and_peers", **company}
    raise NotFound(f"{symbol}: no {view} company page with usable financial data")


def fetch_company(symbol: str, view: str = "auto", *, pause: float = 0.0) -> dict:
    """Convenience entry point that owns and closes its requests session."""
    with requests.Session() as session:
        session.headers["User-Agent"] = UA
        return scrape(session, symbol, view, pause)


def atomic_write_json(path: Path, data: dict) -> None:
    """Preserve the previous daily snapshot if serialization or writing fails."""
    payload = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
        temporary.write_text(payload, encoding="utf-8")
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch one Screener company to JSON")
    ap.add_argument("symbol", help="NSE symbol or numeric BSE code")
    ap.add_argument("--out", default="out", help="output directory")
    ap.add_argument("--view", choices=["auto", "consolidated", "standalone"], default="auto")
    ap.add_argument("--pause", type=float, default=0.0, help="optional minimum seconds between request starts (default 0)")
    args = ap.parse_args(argv)
    try:
        data = fetch_company(args.symbol, args.view, pause=args.pause)
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"{data['requested_identifier']}.json"
        atomic_write_json(path, data)
        print(f"OK {data['symbol']} ({data['view']}) -> {path}; {len(data['warnings'])} warnings")
        return 0
    except (ScrapeError, ValueError, OSError) as exc:
        print(f"FAIL {args.symbol}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
