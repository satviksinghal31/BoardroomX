"""Independent offline regression checks for the main-page request scope."""
import unittest
from unittest.mock import patch
from bs4 import BeautifulSoup
from test_scraper import FIX, Session, m


class PageScopeTests(unittest.TestCase):
    def setUp(self):
        self.html = (FIX / 'RELIANCE.consolidated.html').read_text()
        self.peers = (FIX / 'RELIANCE.peers.html').read_text()

    def scrape(self, main, fallback=None):
        def route(url, kwargs):
            if '/peers/' in url:
                return 200, self.peers, None
            if '/consolidated/' in url and fallback is not None:
                return fallback, main if fallback == 200 else '', None
            standalone = self.html.replace('data-consolidated="true"', 'data-consolidated="false"').replace('Consolidated', 'Standalone')
            return 200, standalone if fallback is not None else main, None
        session = Session(route)
        with patch.object(m.time, 'sleep'):
            result = m.scrape(session, 'RELIANCE')
        return session.calls, result

    def test_normal_scope_is_main_page_plus_peers(self):
        calls, result = self.scrape(self.html)
        self.assertEqual(calls, ['https://www.screener.in/company/RELIANCE/consolidated/',
                                 'https://www.screener.in/api/company/6598251/peers/'])
        self.assertTrue(result['peers']['peers'])

    def test_embedded_peers_require_only_main_page(self):
        soup = BeautifulSoup(self.html, 'html.parser')
        soup.select_one('#peers').append(BeautifulSoup(self.peers, 'html.parser').find('table'))
        calls, result = self.scrape(str(soup))
        self.assertEqual(len(calls), 1)
        self.assertEqual(result['peers'], m.peers_table(self.peers))

    def test_404_fallback_uses_three_requests(self):
        calls, result = self.scrape('', fallback=404)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['fallback_reason'], 'consolidated_not_found')

    def test_empty_financial_fallback_uses_three_requests(self):
        soup = BeautifulSoup(self.html, 'html.parser')
        soup.select_one('#profit-loss').decompose()
        calls, result = self.scrape(str(soup), fallback=200)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['fallback_reason'], 'consolidated_has_no_usable_financials')

    def test_financial_history_and_borrowings_survive_fetch(self):
        calls, result = self.scrape(self.html)
        parsed = m.parse_company(self.html)
        for key in ('quarterly_results', 'profit_loss', 'balance_sheet', 'cash_flow', 'ratios', 'documents'):
            self.assertEqual(result[key], parsed[key], key)
        soup = BeautifulSoup(self.html, 'html.parser')
        table = soup.select_one('#balance-sheet table')
        source = next(row for row in table.find_all('tr') if m.label(m.cells(row)[0].get_text()) == 'Borrowings')
        self.assertEqual([node['borrowings'] for node in result['balance_sheet']],
                         [m.num(cell.get_text()) for cell in m.cells(source)[1:]])
        self.assertTrue(all(node['period_end'] for node in result['balance_sheet']))
