"""Offline operational checks; no real HTTP requests or clock delays."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SPEC = importlib.util.spec_from_file_location("operations_scraper", ROOT / "boardroom_screener_scraper.py")
scraper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scraper)


class FixtureSession:
    def __init__(self, clock, optional_status=200):
        self.clock = clock
        self.optional_status = optional_status
        self.calls = []
        self.closed = False

    def get(self, url, **kwargs):
        self.calls.append((url, self.clock[0], kwargs))
        response = requests.Response()
        response.url = url
        response.status_code = 200 if "/company/RELIANCE/" in url else self.optional_status
        if "/company/RELIANCE/" in url:
            body = (FIXTURES / "RELIANCE.consolidated.html").read_bytes()
        elif "/peers/" in url:
            body = (FIXTURES / "RELIANCE.peers.html").read_bytes()
        else:
            body = b"{}"
        response._content = body
        response.encoding = "utf8"
        return response

    def close(self):
        self.closed = True


class OperationalQA(unittest.TestCase):
    def run_scrape(self, session, clock, **kwargs):
        def advance(seconds):
            clock[0] += seconds
        with patch.object(scraper.time, "monotonic", side_effect=lambda: clock[0]), patch.object(scraper.time, "sleep", side_effect=advance):
            return scraper.scrape(session, "RELIANCE", **kwargs)

    def test_page_fetch_has_only_required_requests_and_optional_pacing(self):
        clock = [0.0]
        session = FixtureSession(clock)
        result = self.run_scrape(session, clock, pause=1)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(sum("/schedules/" in url for url, _, _ in session.calls), 0)
        self.assertEqual(sum("/investors/" in url for url, _, _ in session.calls), 0)
        self.assertEqual([start for _, start, _ in session.calls], list(range(1)))
        self.assertTrue(all(kwargs == {"timeout": 30} for _, _, kwargs in session.calls))
        self.assertEqual(result["scope"], "company_page")
        self.assertEqual(result["warnings"], [])
        self.assertFalse(session.closed)


    def test_reused_session_has_per_call_pacing_and_is_not_closed(self):
        clock = [0.0]
        session = FixtureSession(clock)
        first = self.run_scrape(session, clock, pause=1)
        second = self.run_scrape(session, clock, pause=1)
        self.assertEqual(len(session.calls), 2)
        self.assertEqual([start for _, start, _ in session.calls], [0, 0])
        self.assertFalse(session.closed)
        self.assertIsNot(first, second)
        self.assertNotIn("schedules", first)
        self.assertNotIn("holders", second)


if __name__ == "__main__":
    unittest.main()
