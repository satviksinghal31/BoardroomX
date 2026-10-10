"""Independent, offline data correctness regression checks."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("scraper_data_qa", ROOT / "boardroom_screener_scraper.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def page(periods=("Mar 2026",), metric="Sales", values=("100",), amount="Crores", extra=""):
    header = "".join("<th>" + period + "</th>" for period in periods)
    data = "".join("<td>" + value + "</td>" for value in values)
    return ("<section id='top'><h1>Example Ltd</h1></section>"
            "<div id='company-info' data-company-id='123' data-consolidated='true'></div>"
            "<section id='profit-loss'><p>Consolidated Figures in Rs. " + amount + "</p>"
            "<table><tr><th></th>" + header + "</tr><tr><td>" + metric + "</td>" + data + "</tr></table>"
            + extra + "</section>")




class DataQA(unittest.TestCase):


    def test_ragged_hidden_growth_preserves_main_financials_and_warns(self):
        extra = ("<div class='hidden'><table class='ranges-table'>"
                 "<tr><th>Compounded Sales Growth</th></tr>"
                 "<tr><td>3 Years:</td></tr></table></div>")
        company = m.parse_company(page(extra=extra))
        self.assertEqual(company["profit_loss"]["annual"][0]["sales"], 100)
        self.assertTrue(company["warnings"], "Malformed growth row should be reported")
        growth = company["profit_loss"]["growth"].get("compounded_sales_growth", {})
        self.assertIsNone(growth.get("3_years"))

    def test_source_empty_table_distinguished_from_absent_or_malformed(self):
        for section, key in (('quarters','quarterly_results'), ('profit-loss','profit_loss'), ('balance-sheet','balance_sheet'), ('cash-flow','cash_flow'), ('ratios','ratios')):
            with self.subTest(section=section):
                empty=m.parse_company('<section id="'+section+'"><table><tr><th></th></tr><tr><td>Sales</td></tr></table></section>')
                self.assertIn('No reporting periods in source table: '+key,empty['warnings'])
                absent=m.parse_company('<section id="'+section+'"></section>')
                self.assertFalse(any(w.startswith('No reporting periods') for w in absent['warnings']))
                malformed=m.parse_company('<section id="'+section+'"><table><tr><th></th></tr><tr><td>Sales</td><td>42</td></tr></table></section>')
                self.assertNotIn('No reporting periods in source table: '+key,malformed['warnings'])
                self.assertIn('Malformed source table header: '+key,malformed['warnings'])
                bad_period=m.parse_company('<section id="'+section+'"><table><tr><th></th><th>garbage</th></tr><tr><td>Sales</td><td>42</td></tr></table></section>')
                self.assertIn('Unrecognized table period: garbage',bad_period['warnings'])
                self.assertFalse(any(w.startswith('No reporting periods') for w in bad_period['warnings']))
    def test_real_adl_and_dwarkesh_empty_source_sections(self):
        fixtures=Path(__file__).parent/'fixtures'
        for symbol, missing in [('ADL',['quarterly_results']),('DWARKESH',['balance_sheet','cash_flow','ratios'])]:
            with self.subTest(symbol=symbol):
                data=m.parse_company((fixtures/(symbol+'.financial-sections.html')).read_text())
                self.assertTrue(m.has_financials(data))
                self.assertEqual([w for w in data['warnings'] if w.startswith('No reporting periods')],['No reporting periods in source table: '+key for key in missing])
                for key in missing:self.assertIsNone(data[key])

    def test_invalid_annual_period_warns_and_is_not_usable(self):
        company = m.parse_company(page(periods=("garbage",)))
        self.assertFalse(m.has_financials(company))
        self.assertTrue(company["warnings"], "Unrecognized period should be reported")

    def test_non_march_fiscal_year_dates(self):
        company = m.parse_company(page(periods=("Dec 2024", "Dec 2025"), values=("90", "100")))
        self.assertEqual([row["period_end"] for row in company["profit_loss"]["annual"]],
                         ["2024-12-31", "2025-12-31"])
        self.assertEqual(len(company["profit_loss"]["annual"]), 2)
        self.assertTrue(m.has_financials(company))

    def test_bank_and_nbfc_metric_labels_remain_usable_and_preserved(self):
        for metric, key in (("Revenue", "revenue"), ("Financing Profit", "financing_profit"), ("Net Profit", "net_profit")):
            with self.subTest(metric=metric):
                company = m.parse_company(page(metric=metric, values=("-12.5",)))
                self.assertEqual(company["profit_loss"]["annual"][0][key], -12.5)
                self.assertTrue(m.has_financials(company))

    def test_half_year_display_headers_preserved(self):
        company = m.parse_company(page(periods=("Sep 2025", "Mar 2026"), values=("50", "100")))
        rows = company["profit_loss"]["annual"]
        self.assertEqual([row["period"] for row in rows], ["Sep 2025", "Mar 2026"])
        self.assertEqual([row["period_end"] for row in rows], ["2025-09-30", "2026-03-31"])
        self.assertTrue(m.has_financials(company))


if __name__ == "__main__":
    unittest.main()
