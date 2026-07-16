import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from screener_scraper.cli import main


class FakeScraper:
    def __init__(self, **_kwargs):
        self.logged_in = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def scrape_company(self, ticker, statement="consolidated", sections=None):
        return {
            "ticker": ticker,
            "name": "%s Ltd" % ticker,
            "statement_type": statement,
            "profit_loss": {"years": ["Mar 2025"], "line_items": []},
            "section_status": {"profit_loss": {"status": "ok", "error": None}},
        }


class ScreenerCliTests(unittest.TestCase):
    def test_single_ticker_writes_json_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            code = main(
                ["--ticker", "TDPOWERSYS", "--out-dir", directory, "--delay", "0"],
                scraper_factory=FakeScraper,
            )
            self.assertEqual(code, 0)
            payload = json.loads((Path(directory) / "TDPOWERSYS_consolidated.json").read_text())
            summary = json.loads((Path(directory) / "_scrape_summary.json").read_text())
            self.assertEqual(payload["name"], "TDPOWERSYS Ltd")
            self.assertEqual(summary["succeeded"], 1)
            self.assertEqual(summary["failed"], 0)

    def test_list_sections_needs_no_network(self):
        self.assertEqual(main(["--list-sections"], scraper_factory=FakeScraper), 0)


if __name__ == "__main__":
    unittest.main()
