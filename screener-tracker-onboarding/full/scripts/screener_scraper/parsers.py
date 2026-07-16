"""Pure BeautifulSoup parsers for Screener company HTML."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.screener.in"
PARSER_VERSION = "boardroomx-screener-v1"
TICKER_RE = re.compile(r"^[A-Z0-9&-]+$")

SECTION_IDS = {
    "analysis": "analysis",
    "peers": "peers",
    "quarters": "quarters",
    "profit_loss": "profit-loss",
    "balance_sheet": "balance-sheet",
    "cash_flows": "cash-flow",
    "ratios": "ratios",
    "shareholding": "shareholding",
    "documents": "documents",
}
SECTION_ALIASES = {
    "summary": "summary",
    "analysis": "analysis",
    "pros_cons": "analysis",
    "peers": "peers",
    "peer_comparison": "peers",
    "quarters": "quarters",
    "quarterly": "quarters",
    "quarterly_results": "quarters",
    "profit_loss": "profit_loss",
    "profit-loss": "profit_loss",
    "pnl": "profit_loss",
    "balance_sheet": "balance_sheet",
    "balance-sheet": "balance_sheet",
    "bs": "balance_sheet",
    "cash_flows": "cash_flows",
    "cash_flow": "cash_flows",
    "cash-flow": "cash_flows",
    "cf": "cash_flows",
    "ratios": "ratios",
    "ratio": "ratios",
    "growth_ranges": "growth_ranges",
    "growth": "growth_ranges",
    "shareholding": "shareholding",
    "shareholding_pattern": "shareholding",
    "documents": "documents",
    "docs": "documents",
    "wiki_commentary": "wiki_commentary",
    "wiki": "wiki_commentary",
}
RATIO_KEYS = {
    "Market Cap": "market_cap",
    "Current Price": "current_price",
    "High / Low": "high_low",
    "Stock P/E": "stock_p_e",
    "P/E": "p_e",
    "Book Value": "book_value",
    "Dividend Yield": "dividend_yield",
    "ROCE": "roce",
    "ROE": "roe",
    "Face Value": "face_value",
    "Price To Book": "price_to_book",
}


def clean(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def text(node: Optional[Tag]) -> str:
    return clean(node.get_text(" ", strip=True)) if node else ""


def sanitize_ticker(ticker: str) -> str:
    value = clean(ticker).strip("\"'").upper()
    if not value:
        raise ValueError("Ticker is required")
    if not TICKER_RE.fullmatch(value):
        raise ValueError("Ticker may contain only A-Z, 0-9, '&', and '-'")
    return value


def canonical_section(section: str) -> str:
    key = clean(section).lower()
    if key not in SECTION_ALIASES:
        raise ValueError("Unknown section: %s" % section)
    return SECTION_ALIASES[key]


def to_number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = clean(str(value))
    if raw in {"", "-", "--", "—", "NA", "N/A"}:
        return None
    negative = raw.startswith("(") and raw.endswith(")")
    normalized = raw.replace(",", "").replace("%", "")
    normalized = re.sub(r"[^0-9.+-]", "", normalized)
    if not normalized or normalized in {"-", "+", "."}:
        return None
    try:
        number = float(normalized)
    except ValueError:
        return None
    return -abs(number) if negative else number


def _table_headers(table: Tag) -> List[str]:
    row = table.select_one("thead tr") or table.find("tr")
    if not row:
        return []
    cells = row.find_all(["th", "td"])
    values = [text(cell) for cell in cells]
    return [value for value in values[1:] if value]


def parse_financial_table(table: Optional[Tag]) -> Dict[str, Any]:
    if not table:
        return {"years": [], "line_items": []}
    years = _table_headers(table)
    line_items = []
    body = table.find("tbody") or table
    for row in body.find_all("tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            continue
        name = text(cells[0])
        if not name or name in years:
            continue
        line_items.append({"name": name, "values": [text(cell) for cell in cells[1:]]})
    return {"years": years, "line_items": line_items}


def _section(soup: BeautifulSoup, name: str) -> Optional[Tag]:
    return soup.find(id=SECTION_IDS[name])


def _find_section(soup: BeautifulSoup, name: str) -> Optional[Tag]:
    node = _section(soup, name)
    if node:
        return node
    labels = {
        "analysis": ("analysis", "pros and cons"),
        "peers": ("peer comparison", "peers"),
        "quarters": ("quarterly results", "quarters"),
        "profit_loss": ("profit & loss", "profit and loss", "p&l"),
        "balance_sheet": ("balance sheet",),
        "cash_flows": ("cash flow", "cash flows"),
        "ratios": ("ratios", "financial ratios"),
        "shareholding": ("shareholding pattern", "shareholding"),
        "documents": ("documents",),
    }.get(name, ())
    for heading in soup.find_all(["h2", "h3"]):
        heading_text = text(heading).lower()
        if any(label in heading_text for label in labels):
            return heading.find_parent(["section", "div"]) or heading
    return None


def _is_growth_table(table: Tag) -> bool:
    classes = table.get("class") or []
    return "ranges-table" in classes


def _has_period_headers(table: Tag) -> bool:
    headers = _table_headers(table)
    return any(re.search(r"\b(19|20)\d{2}\b", header) for header in headers)


def _first_financial_table(node: Optional[Tag]) -> Optional[Tag]:
    if not node:
        return None
    for table in node.find_all("table"):
        if not _is_growth_table(table):
            return table
    cursor: Optional[Tag] = node
    while cursor is not None:
        cursor = cursor.find_next(["table", "section", "h2", "h3"])
        if cursor is None:
            break
        if cursor.name == "table" and not _is_growth_table(cursor) and _has_period_headers(cursor):
            return cursor
        if isinstance(cursor, Tag) and node in cursor.parents:
            continue
        if cursor.name in {"section", "h2", "h3"}:
            break
    return None


def _section_table(soup: BeautifulSoup, name: str) -> Dict[str, Any]:
    node = _find_section(soup, name)
    table = _first_financial_table(node)
    return parse_financial_table(table)


def _parse_summary(soup: BeautifulSoup) -> Dict[str, Any]:
    ratios: Dict[str, str] = {}
    for item in soup.select("#top-ratios > li"):
        name = text(item.select_one(".name"))
        value = text(item.select_one(".value, .nowrap, .number"))
        if name and value:
            ratios[name] = value
    for original, alias in RATIO_KEYS.items():
        if original in ratios:
            ratios[alias] = ratios[original]
    profile = soup.select_one(".company-profile")
    about = ""
    key_points = ""
    if profile:
        for title in profile.select(".title"):
            sibling = title.find_next_sibling("div", class_="sub")
            label = text(title).lower()
            if "about" in label:
                about = text(sibling)
            elif "key point" in label:
                key_points = text(sibling)
    read_more = soup.select_one('button[data-url*="/wiki/company/"][data-url*="/commentary/"]')
    wiki_url = urljoin(BASE_URL, read_more.get("data-url")) if read_more else None
    company_id = None
    if read_more and read_more.get("data-url"):
        match = re.search(r"/wiki/company/(\d+)/", read_more["data-url"])
        if match:
            company_id = match.group(1)
    sector = _extract_sector(soup)
    links = _extract_links(soup)
    if sector and "sector" not in ratios:
        ratios["sector"] = sector
    return {
        "name": text(soup.find("h1")),
        "company_id": company_id,
        "ratios_box": ratios,
        "sector": sector,
        "links": links,
        "about": about,
        "key_points": key_points,
        "about_full": clean("%s %s" % (about, key_points)),
        "wiki_commentary_url": wiki_url,
    }


def _extract_sector(soup: BeautifulSoup) -> str:
    for label in ("Sector", "Industry"):
        node = soup.find(
            lambda tag: isinstance(tag, Tag)
            and tag.name in {"span", "div", "li"}
            and text(tag).lower().startswith(label.lower() + ":")
        )
        if node:
            return text(node).split(":", 1)[1].strip()
    return ""


def _extract_links(soup: BeautifulSoup) -> Dict[str, str]:
    links: Dict[str, str] = {}
    for anchor in soup.select("div.company-links a[href]"):
        label = text(anchor)
        href = anchor.get("href")
        if label and href:
            clean_label = re.sub(r"^(BSE|NSE|MCX|NCDEX)\s*:\s*", r"\1", label, flags=re.I)
            clean_label = re.split(r"\s+", clean_label, maxsplit=1)[0]
            links[clean_label] = href
    return links


def _parse_analysis(soup: BeautifulSoup) -> Dict[str, List[str]]:
    node = _find_section(soup, "analysis")
    if not node:
        return {"pros": [], "cons": []}
    return {
        "pros": [text(item) for item in node.select(".pros li") if text(item)],
        "cons": [text(item) for item in node.select(".cons li") if text(item)],
    }


def _rows(parent: Optional[Tag]) -> List[List[str]]:
    if not parent:
        return []
    return [[text(cell) for cell in row.find_all(["th", "td"])] for row in parent.find_all("tr")]


def _parse_peers(soup: BeautifulSoup) -> Dict[str, Any]:
    node = _find_section(soup, "peers")
    table = node.find("table") if node else None
    if not table:
        return {"headers": [], "rows": [], "footer": []}
    headers = _rows(table.find("thead"))
    return {
        "headers": headers[0] if headers else [],
        "rows": [row for row in _rows(table.find("tbody")) if any(row)],
        "footer": [row for row in _rows(table.find("tfoot")) if any(row)],
    }


def _parse_growth_ranges(soup: BeautifulSoup) -> Dict[str, Dict[str, str]]:
    result: Dict[str, Dict[str, str]] = {}
    for table in soup.select("table.ranges-table"):
        heading = text(table.find("th"))
        if not heading:
            continue
        values: Dict[str, str] = {}
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) >= 2:
                values[text(cells[0]).rstrip(":")] = text(cells[1])
        result[heading] = values
    return result


def _parse_shareholding(soup: BeautifulSoup) -> Dict[str, Any]:
    result = {"quarterly": None, "yearly": None}
    node = _find_section(soup, "shareholding")
    if not node:
        return result
    for table in node.find_all("table"):
        parsed = parse_financial_table(table)
        periods = parsed["years"]
        months = [match.group(1) for value in periods if (match := re.match(r"^([A-Z][a-z]{2})\s+\d{4}$", value))]
        if not months:
            continue
        counts = Counter(months)
        quarterly = len(counts) >= 3 and counts.most_common(1)[0][1] / len(months) < 0.7
        key = "quarterly" if quarterly else "yearly"
        if result[key] is None:
            result[key] = parsed
    return result


def _parse_documents(soup: BeautifulSoup) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "annual_reports": [],
        "credit_ratings": [],
        "concalls": [],
        "announcements": [],
        "raw_text": "",
    }
    node = _find_section(soup, "documents")
    if not node:
        return result
    category = None
    for child in node.find_all(["h3", "a"]):
        if child.name == "h3":
            label = text(child).lower()
            category = (
                "annual_reports" if "annual" in label else
                "credit_ratings" if "credit" in label else
                "concalls" if "concall" in label else
                "announcements" if "announcement" in label else None
            )
        elif category and child.get("href"):
            result[category].append({"text": text(child), "url": urljoin(BASE_URL, child["href"])})
    result["raw_text"] = text(node)
    return result


def _available(value: Any) -> bool:
    if isinstance(value, dict):
        if value.get("years"):
            return True
        return any(_available(item) for item in value.values())
    if isinstance(value, list):
        return bool(value)
    return value not in (None, "")


def parse_company_html(html: str, ticker: str, source_url: str, logged_in: bool) -> Dict[str, Any]:
    symbol = sanitize_ticker(ticker)
    soup = BeautifulSoup(html or "", "html.parser")
    summary = _parse_summary(soup)
    sections: Dict[str, Any] = {
        "analysis": _parse_analysis(soup),
        "peers": _parse_peers(soup),
        "quarters": _section_table(soup, "quarters"),
        "profit_loss": _section_table(soup, "profit_loss"),
        "balance_sheet": _section_table(soup, "balance_sheet"),
        "cash_flows": _section_table(soup, "cash_flows"),
        "ratios": _section_table(soup, "ratios"),
        "growth_ranges": _parse_growth_ranges(soup),
        "shareholding": _parse_shareholding(soup),
        "documents": _parse_documents(soup),
    }
    status = {
        name: {"status": "ok" if _available(value) else "unavailable", "error": None}
        for name, value in sections.items()
    }
    return {
        "schema_version": 1,
        "parser_version": PARSER_VERSION,
        "ticker": symbol,
        "url": source_url,
        "statement_type": "consolidated" if "/consolidated/" in source_url else "standalone",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "logged_in": bool(logged_in),
        **summary,
        **sections,
        "wiki_commentary": None,
        "section_status": status,
    }
