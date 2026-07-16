"""HTTP client and public Screener scraper API."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .parsers import BASE_URL, canonical_section, clean, parse_company_html, sanitize_ticker, text

log = logging.getLogger("screener_scraper")


class ScreenerError(Exception):
    """Base scraper error."""


class FetchError(ScreenerError):
    """Network or non-success HTTP response."""


class RateLimitError(FetchError):
    """Screener asked the client to slow down."""


class LoginError(ScreenerError):
    """Authentication was requested but failed."""


class CompanyNotFoundError(FetchError):
    """Ticker page does not exist."""


@dataclass(frozen=True)
class ScraperConfig:
    delay: float = 0.0
    timeout: Tuple[float, float] = (10.0, 30.0)
    max_retries: int = 3
    backoff: float = 1.5
    user_agent: str = "BoardroomX Screener ingestion/1.0 (personal research; sequential requests)"
    accept_language: str = "en-IN,en;q=0.9"
    out_dir: Path = field(default_factory=lambda: Path("outputs/screener"))
    sections: Optional[List[str]] = None


class ScreenerScraper:
    def __init__(
        self,
        username: Optional[str] = None,
        password: Optional[str] = None,
        config: Optional[ScraperConfig] = None,
        session=None,
    ):
        self.config = config or ScraperConfig()
        self.session = session or self._build_session()
        self.logged_in = False
        username = username or os.environ.get("SCREENER_USER")
        password = password or os.environ.get("SCREENER_PASS")
        if username or password:
            if not username or not password:
                raise LoginError("Both Screener username and password are required")
            self._login(username, password)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def close(self):
        self.session.close()

    def _build_session(self):
        session = requests.Session()
        session.headers.update({
            "User-Agent": self.config.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": self.config.accept_language,
        })
        retry = Retry(
            total=self.config.max_retries,
            connect=self.config.max_retries,
            read=self.config.max_retries,
            status=self.config.max_retries,
            backoff_factor=self.config.backoff,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(("GET", "POST")),
            respect_retry_after_header=True,
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=1)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def _request(self, url: str, **kwargs):
        kwargs.setdefault("timeout", self.config.timeout)
        try:
            response = self.session.get(url, **kwargs)
        except requests.RequestException as exc:
            raise FetchError("GET %s failed: %s" % (url, exc)) from exc
        if response.status_code == 404:
            raise CompanyNotFoundError("Company page not found: %s" % url)
        if response.status_code == 429:
            raise RateLimitError("Screener rate limit reached for %s" % url)
        if response.status_code >= 400:
            raise FetchError("Screener returned HTTP %s for %s" % (response.status_code, url))
        return response

    def _login(self, username: str, password: str):
        login_url = "%s/login/" % BASE_URL
        response = self._request(login_url)
        soup = BeautifulSoup(response.text, "html.parser")
        token = soup.select_one('input[name="csrfmiddlewaretoken"]')
        if not token or not token.get("value"):
            raise LoginError("Screener login page did not contain a CSRF token")
        try:
            result = self.session.post(
                login_url,
                data={
                    "csrfmiddlewaretoken": token["value"],
                    "username": username,
                    "password": password,
                    "next": "/",
                },
                headers={"Referer": login_url, "Origin": BASE_URL},
                timeout=self.config.timeout,
            )
        except requests.RequestException as exc:
            raise LoginError("Screener login request failed") from exc
        if result.status_code >= 400 or "/login/" in result.url or "logout" not in result.text.lower():
            raise LoginError("Screener login was rejected")
        self.logged_in = True

    def _fetch_company(self, ticker: str, statement: str):
        suffix = "consolidated/" if statement == "consolidated" else ""
        url = "%s/company/%s/%s" % (BASE_URL, ticker, suffix)
        response = self._request(url)
        return parse_company_html(response.text, ticker, url, self.logged_in)

    def scrape_company(self, ticker: str, statement: str = "consolidated", sections: Optional[Sequence[str]] = None):
        symbol = sanitize_ticker(ticker)
        statement = clean(statement).lower()
        if statement not in {"consolidated", "standalone"}:
            raise ValueError("statement must be consolidated or standalone")
        result = self._fetch_company(symbol, statement)
        if statement == "consolidated" and not result["profit_loss"]["years"]:
            result = self._fetch_company(symbol, "standalone")
        result["is_consolidated"] = result["statement_type"] == "consolidated"
        if result.get("wiki_commentary_url") and self.logged_in:
            self._add_wiki_commentary(result)
        wanted = sections if sections is not None else self.config.sections
        if wanted:
            canonical = {canonical_section(name) for name in wanted}
            result["requested_sections"] = sorted(canonical)
        if self.config.delay > 0:
            time.sleep(self.config.delay)
        return result

    def _add_wiki_commentary(self, result):
        response = self._request(
            result["wiki_commentary_url"],
            headers={"X-Requested-With": "XMLHttpRequest", "Referer": result["url"]},
        )
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        result["wiki_commentary"] = text(soup) or None
        result["section_status"]["wiki_commentary"] = {
            "status": "ok" if result["wiki_commentary"] else "unavailable",
            "error": None,
        }

    def scrape_section(self, ticker: str, section: str, statement: str = "consolidated"):
        name = canonical_section(section)
        result = self.scrape_company(ticker, statement=statement, sections=[name])
        return result.get(name)

    def available_sections(self, ticker: str, statement: str = "consolidated"):
        result = self.scrape_company(ticker, statement=statement)
        return ["summary"] + [
            name for name, status in result["section_status"].items()
            if status["status"] == "ok"
        ]

    @staticmethod
    def compute_cagr(values, years: int):
        if years < 1 or len(values) < years + 1:
            return None
        window = values[-(years + 1):]
        start, end = window[0], window[-1]
        if start is None or end is None or start <= 0 or end < 0:
            return None
        try:
            return (end / start) ** (1.0 / years) - 1.0
        except (ArithmeticError, ValueError, TypeError):
            return None
