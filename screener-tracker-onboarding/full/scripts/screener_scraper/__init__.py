"""Reusable Screener.in scraper library."""

from .parsers import (
    PARSER_VERSION,
    canonical_section,
    parse_company_html,
    sanitize_ticker,
    to_number,
)
from .client import (
    CompanyNotFoundError,
    FetchError,
    LoginError,
    RateLimitError,
    ScraperConfig,
    ScreenerError,
    ScreenerScraper,
)

__all__ = [
    "PARSER_VERSION",
    "canonical_section",
    "parse_company_html",
    "sanitize_ticker",
    "to_number",
    "CompanyNotFoundError",
    "FetchError",
    "LoginError",
    "RateLimitError",
    "ScraperConfig",
    "ScreenerError",
    "ScreenerScraper",
]
