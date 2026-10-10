"""Independent offline checks for the company-page-only scope and contract."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
FIX = Path(__file__).resolve().parent / 'fixtures'
spec = importlib.util.spec_from_file_location('page_scope_scraper', ROOT / 'boardroom_screener_scraper.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Session:
    def __init__(self, route):
        self.route, self.calls = route, []
    def get(self, url, **kwargs):
        self.calls.append(url)
        status, body = self.route(url)
        response = requests.Response()
        response.status_code, response._content = status, body.encode()
        response.url, response.encoding = url, 'utf8'
        return response

class PageScopeTests(unittest.TestCase):
    def setUp(self):
        self.html = (FIX / 'RELIANCE.consolidated.html').read_text()

    def scrape(self, main=None, fallback=None):
        main = self.html if main is None else main
        standalone = self.html.replace('data-consolidated="true"', 'data-consolidated="false"').replace('Consolidated', 'Standalone')
        def route(url):
            if '/api/' in url:
                self.fail('Unexpected API request: ' + url)
            if '/consolidated/' in url:
                return (fallback or 200), main
            return 200, standalone
        session = Session(route)
        with patch.object(m.time, 'sleep') as sleep:
            result = m.scrape(session, 'RELIANCE')
        sleep.assert_not_called()
        return session.calls, result

    def test_normal_scope_is_one_page_without_peers(self):
        calls, result = self.scrape()
        self.assertEqual(calls, ['https://www.screener.in/company/RELIANCE/consolidated/'])
        self.assertNotIn('peers', result)
        self.assertNotIn('scope',result)
        self.assertNotIn('schema_version',result)

    def test_embedded_peers_are_excluded_and_do_not_trigger_requests(self):
        soup = BeautifulSoup(self.html, 'html.parser')
        soup.select_one('#peers').append(BeautifulSoup((FIX / 'RELIANCE.peers.html').read_text(), 'html.parser').find('table'))
        calls, result = self.scrape(str(soup))
        self.assertEqual(len(calls), 1)
        self.assertNotIn('peers', result)

    def test_404_fallback_uses_two_requests(self):
        calls, result = self.scrape('', fallback=404)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['fallback_reason'], 'consolidated_not_found')

    def test_empty_financial_fallback_uses_two_requests(self):
        soup = BeautifulSoup(self.html, 'html.parser')
        soup.select_one('#profit-loss').decompose()
        calls, result = self.scrape(str(soup))
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['fallback_reason'], 'consolidated_has_no_usable_financials')

    def test_financial_history_borrowings_documents_and_units_survive_fetch(self):
        _, result = self.scrape()
        parsed = m.parse_company(self.html)
        for key in ('quarterly_results', 'profit_loss', 'balance_sheet', 'cash_flow', 'ratios', 'documents', 'units'):
            self.assertEqual(result[key], parsed[key], key)
        soup = BeautifulSoup(self.html, 'html.parser')
        source = next(row for row in soup.select_one('#balance-sheet table').find_all('tr')
                      if m.label(m.cells(row)[0].get_text()) == 'Borrowings')
        self.assertEqual([node['borrowings'] for node in result['balance_sheet']],
                         [m.num(cell.get_text()) for cell in m.cells(source)[1:]])
        self.assertTrue(all(node['period_end'] for node in result['balance_sheet']))
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)

    def test_invalid_annual_structure_is_controlled(self):
        _, valid = self.scrape()
        for annual in (123, [123]):
            with self.subTest(annual=annual):
                data = copy.deepcopy(valid)
                data['profit_loss']['annual'] = annual
                with self.assertRaises(m.ScrapeError):
                    m.validate_company(data)

    def test_invalid_period_date_is_rejected(self):
        _, valid = self.scrape()
        for date in (123, '2026-99-99'):
            with self.subTest(date=date):
                data = copy.deepcopy(valid)
                data['balance_sheet'][0]['period_end'] = date
                with self.assertRaises(m.ScrapeError):
                    m.validate_company(data)

    def test_nonfinite_values_are_rejected(self):
        _, data = self.scrape()
        data['key_ratios']['price'] = float('nan')
        with self.assertRaises(m.ScrapeError):
            m.validate_company(data)
