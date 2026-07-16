#!/usr/bin/env python3
"""Parse cached Value Research fund pages into auditable phase-one JSON."""

from __future__ import annotations

import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "mutual-funds" / "value-research" / "raw"
PRIVATE_OUT = ROOT / "data" / "mutual-funds" / "value-research" / "fund-facts.json"
PUBLIC_OUT = ROOT / "public" / "data" / "mutual-funds" / "fund-facts.json"
CAPTURED_AT = "2026-07-16T03:36:00+00:00"

EXPECTED = {
    "40564": {
        "fund_key": "bandhan-small-cap",
        "display_name": "Bandhan Small Cap Fund - Direct Plan",
        "amc": "Bandhan Mutual Fund",
        "url": "https://www.valueresearchonline.com/funds/40564/bandhan-small-cap-fund-direct-plan/",
    },
    "17366": {
        "fund_key": "quant-small-cap",
        "display_name": "Quant Small Cap Fund - Direct Plan",
        "amc": "Quant Mutual Fund",
        "url": "https://www.valueresearchonline.com/funds/17366/quant-small-cap-fund-direct-plan/",
    },
    "38283": {
        "fund_key": "bank-of-india-small-cap",
        "display_name": "Bank of India Small Cap Fund - Direct Plan",
        "amc": "Bank of India Mutual Fund",
        "url": "https://www.valueresearchonline.com/funds/38283/bank-of-india-small-cap-fund-direct-plan/",
    },
}


class JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capturing = False
        self._chunks: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value for key, value in attrs}
        if tag.lower() == "script" and attrs_dict.get("type") == "application/ld+json":
            self._capturing = True
            self._chunks = []

    def handle_data(self, data: str) -> None:
        if self._capturing:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capturing:
            self.scripts.append("".join(self._chunks).strip())
            self._capturing = False
            self._chunks = []


def parse_number(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def find_financial_product(raw_html: str) -> dict:
    parser = JsonLdParser()
    parser.feed(raw_html)
    for script in parser.scripts:
        try:
            payload = json.loads(script)
        except json.JSONDecodeError:
            continue
        items = payload if isinstance(payload, list) else [payload]
        for item in items:
            types = item.get("@type", []) if isinstance(item, dict) else []
            if isinstance(types, str):
                types = [types]
            if "FinancialProduct" in types:
                return item
    raise ValueError("missing FinancialProduct JSON-LD")


def property_map(product: dict) -> dict[str, dict]:
    mapped: dict[str, dict] = {}
    for prop in product.get("additionalProperty", []):
        if isinstance(prop, dict) and prop.get("name"):
            mapped[str(prop["name"])] = prop
    return mapped


def prop_value(props: dict[str, dict], name: str) -> object:
    return props.get(name, {}).get("value")


def normalize(fund_id: str, raw_path: Path, retrieved_at: str) -> dict:
    raw_bytes = raw_path.read_bytes()
    raw_html = raw_bytes.decode("utf-8", errors="replace")
    raw_sha = hashlib.sha256(raw_bytes).hexdigest()
    product = find_financial_product(raw_html)
    props = property_map(product)
    expected = EXPECTED[fund_id]

    identifiers = product.get("identifier", [])
    displayed_id = None
    for item in identifiers:
        if isinstance(item, dict) and item.get("name") == "VRO Fund ID":
            displayed_id = str(item.get("value"))

    name = product.get("name")
    amc = product.get("brand", {}).get("name") if isinstance(product.get("brand"), dict) else None
    identity_match = (
        displayed_id == fund_id
        and name == expected["display_name"]
        and amc == expected["amc"]
    )
    if not identity_match:
        raise ValueError(f"identity mismatch for Value Research fund {fund_id}")

    warnings = []
    if len(raw_bytes) == 200_011:
        warnings.append("Raw browser-rendered HTML hit the acquisition return-size limit; only JSON-LD overview fields are treated as audit-ready.")
    warnings.append("Portfolio holdings were not captured with expansion evidence; holdings completeness is unknown.")

    missing_fields = [
        "portfolio.holdings",
        "portfolio.sectors",
        "portfolio.turnover",
        "management.current_managers",
        "risk.source_labelled_measures",
    ]

    additional_fields = []
    known_props = {
        "AUM",
        "Expense Ratio",
        "Launch Date",
        "Minimum Investment",
        "Minimum SIP Investment",
        "Exit Load",
        "1Y Return",
        "3Y Return",
        "5Y Return",
        "10Y Return",
    }
    for label, prop in props.items():
        if label not in known_props:
            additional_fields.append({
                "section": "overview",
                "label": label,
                "raw_value": prop.get("value"),
                "parsed_value": parse_number(prop.get("value")),
                "unit": prop.get("unitText"),
                "as_of": None,
                "source_url": expected["url"],
            })

    record = {
        "schema_version": "1.0",
        "source": {
            "provider": "Value Research",
            "fund_id": fund_id,
            "urls": [expected["url"]],
            "retrieved_at": retrieved_at,
            "raw_sha256": [raw_sha],
            "canonical_sha256": None,
            "tabs_captured": ["overview"],
            "raw_path": str(raw_path.relative_to(ROOT)),
        },
        "identity": {
            "fund_key": expected["fund_key"],
            "displayed_scheme_name": name,
            "expected_scheme_name": expected["display_name"],
            "amc": amc,
            "plan": "Direct",
            "option": "Growth",
            "fund_id": displayed_id,
        },
        "dates": {
            "nav_as_of": product.get("offers", {}).get("priceValidUntil") if isinstance(product.get("offers"), dict) else None,
            "aum_as_of": None,
            "portfolio_as_of": None,
            "returns_as_of": None,
            "retrieved_at": retrieved_at,
        },
        "fund_details": {
            "nav": {
                "raw_value": product.get("offers", {}).get("price") if isinstance(product.get("offers"), dict) else None,
                "parsed_value": parse_number(product.get("offers", {}).get("price") if isinstance(product.get("offers"), dict) else None),
                "unit": "INR",
                "as_of": product.get("offers", {}).get("priceValidUntil") if isinstance(product.get("offers"), dict) else None,
            },
            "aum": {
                "raw_value": prop_value(props, "AUM"),
                "parsed_value": parse_number(prop_value(props, "AUM")),
                "unit": props.get("AUM", {}).get("unitText"),
                "as_of": None,
            },
            "launch_date": prop_value(props, "Launch Date"),
            "rating": {
                "raw_value": product.get("aggregateRating", {}).get("ratingValue") if isinstance(product.get("aggregateRating"), dict) else None,
                "best": product.get("aggregateRating", {}).get("bestRating") if isinstance(product.get("aggregateRating"), dict) else None,
            },
        },
        "costs_and_investment": {
            "expense_ratio": {
                "raw_value": prop_value(props, "Expense Ratio"),
                "parsed_value": parse_number(prop_value(props, "Expense Ratio")),
                "unit": props.get("Expense Ratio", {}).get("unitText"),
                "as_of": None,
            },
            "minimum_investment": {
                "raw_value": prop_value(props, "Minimum Investment"),
                "parsed_value": parse_number(prop_value(props, "Minimum Investment")),
                "unit": props.get("Minimum Investment", {}).get("unitText"),
            },
            "minimum_sip_investment": {
                "raw_value": prop_value(props, "Minimum SIP Investment"),
                "parsed_value": parse_number(prop_value(props, "Minimum SIP Investment")),
                "unit": props.get("Minimum SIP Investment", {}).get("unitText"),
            },
            "exit_load": prop_value(props, "Exit Load"),
        },
        "management": {
            "current_managers": None,
        },
        "performance": {
            "point_to_point": [
                {
                    "label": label,
                    "raw_value": prop_value(props, label),
                    "parsed_value": parse_number(prop_value(props, label)),
                    "unit": props.get(label, {}).get("unitText"),
                    "as_of": None,
                }
                for label in ("1Y Return", "3Y Return", "5Y Return", "10Y Return")
                if label in props
            ],
        },
        "risk": {},
        "portfolio": {
            "holdings": [],
            "sectors": [],
            "turnover": None,
            "holdings_completeness": "unknown",
            "partial_reason": "No expanded holdings table was captured from the public page.",
        },
        "additional_fields": additional_fields,
        "missing_fields": missing_fields,
        "warnings": warnings,
        "quality": {
            "identity_match": identity_match,
            "section_markers": {"overview_json_ld": True, "portfolio_holdings": False},
            "audit_ready": identity_match,
            "raw_capture_bytes": len(raw_bytes),
            "holdings_completeness": "unknown",
        },
    }
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    record["source"]["canonical_sha256"] = hashlib.sha256(canonical).hexdigest()
    return record


def public_view(records: list[dict], generated_at: str) -> dict:
    rows = []
    for record in records:
        returns = {item["label"]: item for item in record["performance"]["point_to_point"]}
        rows.append({
            "fund_key": record["identity"]["fund_key"],
            "fund_id": record["source"]["fund_id"],
            "name": record["identity"]["displayed_scheme_name"],
            "amc": record["identity"]["amc"],
            "nav": record["fund_details"]["nav"],
            "aum": record["fund_details"]["aum"],
            "expense_ratio": record["costs_and_investment"]["expense_ratio"],
            "launch_date": record["fund_details"]["launch_date"],
            "rating": record["fund_details"]["rating"],
            "returns": {
                "1Y": returns.get("1Y Return"),
                "3Y": returns.get("3Y Return"),
                "5Y": returns.get("5Y Return"),
                "10Y": returns.get("10Y Return"),
            },
            "manager": None,
            "turnover": None,
            "portfolio_status": record["portfolio"]["holdings_completeness"],
            "warnings": record["warnings"],
        })
    return {
        "schema_version": "1.0",
        "provider": "Value Research",
        "generated_at": generated_at,
        "retrieval_note": "Phase-one overview facts parsed from cached Value Research JSON-LD. Portfolio holdings are not complete.",
        "funds": rows,
    }


def main() -> None:
    retrieved_at = CAPTURED_AT
    records = []
    for fund_id in EXPECTED:
        records.append(normalize(fund_id, RAW_DIR / f"{fund_id}-overview.html", retrieved_at))

    payload = {
        "schema_version": "1.0",
        "provider": "Value Research",
        "generated_at": retrieved_at,
        "records": records,
    }
    PRIVATE_OUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT.parent.mkdir(parents=True, exist_ok=True)
    PRIVATE_OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    PUBLIC_OUT.write_text(json.dumps(public_view(records, retrieved_at), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {PRIVATE_OUT.relative_to(ROOT)}")
    print(f"Wrote {PUBLIC_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
