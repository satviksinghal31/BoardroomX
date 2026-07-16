import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from screener_scraper import CompanyNotFoundError, ScreenerScraper, ScraperConfig


HTML = (Path(__file__).parent / "fixtures" / "standard_company.html").read_text()


class FakeResponse:
    def __init__(self, text, status_code=200, url="https://www.screener.in/"):
        self.text = text
        self.status_code = status_code
        self.url = url
        self.headers = {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP %s" % self.status_code)


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.closed = False

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)

    def close(self):
        self.closed = True


class ScreenerClientTests(unittest.TestCase):
    def test_consolidated_success_and_section_alias(self):
        session = FakeSession([FakeResponse(HTML), FakeResponse(HTML)])
        scraper = ScreenerScraper(session=session, config=ScraperConfig(delay=0))
        data = scraper.scrape_company("TDPOWERSYS")
        pnl = scraper.scrape_section("TDPOWERSYS", "pnl")
        self.assertTrue(data["is_consolidated"])
        self.assertEqual(pnl["years"][-1], "Mar 2026")
        self.assertEqual(len(pnl["years"]), 12)
        self.assertIn("/consolidated/", session.calls[0][0])
        self.assertIn("timeout", session.calls[0][1])

    def test_falls_back_to_standalone_when_consolidated_has_no_pnl(self):
        session = FakeSession([FakeResponse("<h1>Empty</h1>"), FakeResponse(HTML)])
        data = ScreenerScraper(session=session, config=ScraperConfig(delay=0)).scrape_company("TDPOWERSYS")
        self.assertFalse(data["is_consolidated"])
        self.assertNotIn("/consolidated/", session.calls[1][0])

    def test_404_is_typed_and_context_manager_closes(self):
        session = FakeSession([FakeResponse("missing", 404)])
        with self.assertRaises(CompanyNotFoundError):
            with ScreenerScraper(session=session, config=ScraperConfig(delay=0)) as scraper:
                scraper.scrape_company("MISSING")
        self.assertTrue(session.closed)

    def test_compute_cagr_contract(self):
        values = [597, 507, 380, 435, 459, 515, 594, 797, 872, 1001, 1279]
        self.assertAlmostEqual(ScreenerScraper.compute_cagr(values, 10), (1279 / 597) ** 0.1 - 1)
        self.assertIsNone(ScreenerScraper.compute_cagr([0, 10], 1))
        self.assertIsNone(ScreenerScraper.compute_cagr([10], 1))


if __name__ == "__main__":
    unittest.main()
