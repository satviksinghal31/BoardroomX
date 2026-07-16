import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from screener_scraper import parse_company_html, sanitize_ticker, to_number


FIXTURE = Path(__file__).parent / "fixtures" / "standard_company.html"
URL = "https://www.screener.in/company/TDPOWERSYS/consolidated/"


class ScreenerParserTests(unittest.TestCase):
    def test_standard_company_contract_covers_every_section(self):
        data = parse_company_html(FIXTURE.read_text(), "TDPOWERSYS", URL, False)
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["name"], "TD Power Systems Ltd")
        self.assertEqual(data["company_id"], "123")
        self.assertEqual(data["sector"], "Capital Goods")
        self.assertEqual(data["links"]["Website"], "https://tdps.co.in/")
        self.assertEqual(data["ratios_box"]["Market Cap"], "₹ 6,500 Cr.")
        self.assertEqual(data["ratios_box"]["market_cap"], "₹ 6,500 Cr.")
        self.assertEqual(data["ratios_box"]["sector"], "Capital Goods")
        self.assertEqual(data["analysis"], {"pros": ["Debt free"], "cons": ["Cyclical demand"]})
        self.assertEqual(data["peers"]["footer"][0][0], "Median")
        self.assertEqual(data["quarters"]["years"][0], "Mar 2023")
        self.assertEqual(data["quarters"]["years"][-1], "Mar 2026")
        self.assertEqual(len(data["quarters"]["years"]), 13)
        self.assertGreaterEqual(len(data["quarters"]["line_items"]), 6)
        self.assertEqual(data["profit_loss"]["years"][-1], "Mar 2026")
        self.assertEqual(len(data["profit_loss"]["years"]), 12)
        self.assertEqual(data["balance_sheet"]["line_items"][0]["name"], "Borrowings")
        self.assertEqual(data["cash_flows"]["years"][-1], "Mar 2026")
        self.assertEqual(len(data["cash_flows"]["years"]), 12)
        self.assertGreaterEqual(len(data["cash_flows"]["line_items"]), 4)
        self.assertEqual(data["ratios"]["line_items"][0]["name"], "ROCE %")
        self.assertEqual(len(data["growth_ranges"]), 4)
        self.assertIsNotNone(data["shareholding"]["quarterly"])
        self.assertIsNotNone(data["shareholding"]["yearly"])
        self.assertEqual(data["shareholding"]["quarterly"]["years"][0], "Sep 2023")
        self.assertEqual(data["shareholding"]["quarterly"]["years"][-1], "Jun 2026")
        self.assertEqual(len(data["shareholding"]["quarterly"]["years"]), 12)
        self.assertEqual(data["shareholding"]["yearly"]["years"][0], "Mar 2017")
        self.assertEqual(data["shareholding"]["yearly"]["years"][-1], "Jun 2026")
        self.assertEqual(len(data["shareholding"]["yearly"]["years"]), 11)
        self.assertEqual(data["documents"]["annual_reports"][0]["url"], "https://www.screener.in/company/annual-report/1/")
        self.assertIn("Financial Year 2025", data["documents"]["raw_text"])
        self.assertEqual(data["wiki_commentary_url"], "https://www.screener.in/wiki/company/123/commentary/")
        self.assertTrue(all(v["status"] == "ok" for v in data["section_status"].values()))

    def test_financial_section_finds_table_after_heading_and_keeps_all_rows(self):
        html = """
        <h1>Layout Drift Ltd</h1>
        <section id="profit-loss"><h2>Profit & Loss</h2></section>
        <div class="responsive-holder">
          <table>
            <thead>
              <tr><th></th><th>Mar 2015</th><th>Mar 2016</th><th>Mar 2026</th></tr>
            </thead>
            <tbody>
              <tr><td>Sales</td><td>1</td><td>2</td><td>12</td></tr>
              <tr><td>Expenses</td><td>1</td><td>1</td><td>8</td></tr>
              <tr><td>Net Profit</td><td>0</td><td>1</td><td>4</td></tr>
            </tbody>
          </table>
        </div>
        """
        data = parse_company_html(html, "LAYOUT", "https://www.screener.in/company/LAYOUT/", False)
        self.assertEqual(data["profit_loss"]["years"], ["Mar 2015", "Mar 2016", "Mar 2026"])
        self.assertEqual([item["name"] for item in data["profit_loss"]["line_items"]], ["Sales", "Expenses", "Net Profit"])

    def test_missing_optional_sections_are_explicitly_unavailable(self):
        data = parse_company_html("<h1>New Co Ltd</h1>", "NEWCO", "https://www.screener.in/company/NEWCO/", False)
        self.assertEqual(data["section_status"]["profit_loss"]["status"], "unavailable")
        self.assertEqual(data["documents"]["annual_reports"], [])

    def test_validation_and_numeric_conversion(self):
        self.assertEqual(sanitize_ticker(" td-power "), "TD-POWER")
        with self.assertRaises(ValueError):
            sanitize_ticker("../TCS")
        self.assertEqual(to_number("(1,234.5)"), -1234.5)
        self.assertEqual(to_number("31.2 %"), 31.2)
        self.assertIsNone(to_number("--"))


if __name__ == "__main__":
    unittest.main()
