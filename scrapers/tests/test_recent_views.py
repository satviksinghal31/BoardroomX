"""Deterministic recent annual/quarterly auto-view selection, no HTTP traffic."""
import copy
from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch
from test_scraper import FIX, Session, m

AS_OF=date(2026,10,31)
class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None): return cls(2026,10,31,tzinfo=timezone.utc)

def node(period, value=0, metric='sales'):
    return {'period':period,'period_end':m.period_end(period),metric:value}
def company():
    return {'profit_loss':{'annual':[node('Oct 2024'),node('Mar 2025'),node('Mar 2026')]},'quarterly_results':[node('Jan 2026'),node('Apr 2026')]}
def page(view='consolidated', annual=('Mar 2025','Mar 2026'), quarters=('Mar 2026','Jun 2026'), code='TEST', value='0'):
    def table(section, periods):
        return '<section id="'+section+'"><p>'+view.title()+'</p><table><tr><th></th>'+''.join('<th>'+p+'</th>' for p in periods)+'</tr><tr><td>Net Profit</td>'+''.join('<td>'+value+'</td>' for _ in periods)+'</tr></table></section>'
    return '<section id="top"><h1>Test Ltd</h1><a href="https://www.nseindia.com/">NSE: '+code+'</a></section><div id="company-info" data-company-id="1" data-consolidated="'+str(view=='consolidated').lower()+'"></div>'+table('profit-loss',annual)+table('quarters',quarters)

class RecentViewTests(unittest.TestCase):
    def test_annual_calendar_boundary_distinct_years_and_future_ttm(self):
        data=company();self.assertTrue(m.has_recent_financials(data,AS_OF))
        data['profit_loss']['annual']=[node('Oct 2024'),node('Mar 2025')]
        self.assertTrue(m.has_recent_financials(data,AS_OF))
        self.assertFalse(m.has_recent_financials(data,date(2026,11,1)))
        for rows in ([node('Mar 2026'),node('Sep 2026')],[node('Mar 2026'),node('TTM')],[node('Mar 2026'),node('Mar 2027')],[node('Mar 2025',None),node('Mar 2026')]):
            data['profit_loss']['annual']=rows;self.assertFalse(m.has_recent_financials(data,AS_OF))
    def test_quarter_calendar_boundaries_consecutive_distinct_and_recent(self):
        data=company();self.assertTrue(m.has_recent_financials(data,AS_OF))
        self.assertFalse(m.has_recent_financials(data,date(2026,11,1)))
        for periods in [('Apr 2026',),('Mar 2026','Sep 2026'),('Dec 2025','Mar 2026'),('Apr 2026','TTM'),('Sep 2026','Dec 2026'),('Apr 2026','Apr 2026')]:
            data['quarterly_results']=[node(p) for p in periods];self.assertFalse(m.has_recent_financials(data,AS_OF),periods)
    def test_zero_negative_bank_financials_are_numeric_not_null_headers(self):
        data=company()
        data['profit_loss']['annual']=[node('Mar 2025',0,'revenue'),node('Mar 2026',-3,'financing_profit')]
        data['quarterly_results']=[node('Mar 2026',0,'revenue'),node('Jun 2026',-2,'financing_profit')]
        self.assertTrue(m.has_recent_financials(data,AS_OF))
        for value in (None,'42',True,float('nan'),float('inf')):
            bad=copy.deepcopy(data);bad['quarterly_results'][-1]['financing_profit']=value;self.assertFalse(m.has_recent_financials(bad,AS_OF))
    def test_leap_day_calendar_cutoff(self):
        data={'profit_loss':{'annual':[node('Feb 2022'),node('Mar 2023')]},'quarterly_results':[node('May 2023'),node('Aug 2023')]}
        self.assertTrue(m.has_recent_financials(data,date(2024,2,29)))
        self.assertFalse(m.has_recent_financials(data,date(2024,3,1)))
    def scrape(self, consolidated, standalone, statuses=(200,200)):
        session=Session(lambda u,k:(statuses[0] if '/consolidated/' in u else statuses[1],consolidated if '/consolidated/' in u else standalone,None))
        with patch.object(m,'datetime',FixedDatetime): result=m.scrape(session,'TEST')
        return session,result
    def test_recent_consolidated_returns_single_request(self):
        session,result=self.scrape(page(),page('standalone'));self.assertEqual(len(session.calls),1);self.assertEqual(result['view'],'consolidated')
    def test_stale_or_young_consolidated_uses_entire_recent_standalone(self):
        for consolidated in (page(annual=('Mar 2026',)),page(quarters=('Mar 2025','Jun 2025'))):
            standalone=page('standalone',value='77');session,result=self.scrape(consolidated,standalone)
            self.assertEqual(len(session.calls),2);self.assertEqual(result['view'],'standalone');self.assertEqual(result['fallback_reason'],'consolidated_missing_recent_financials')
            self.assertEqual([r['net_profit'] for r in result['profit_loss']['annual']],[77,77])
    def test_annual_only_or_old_standalone_retains_all_available_financials(self):
        for standalone in (page('standalone',annual=('Mar 2026',),quarters=(),value='88'),page('standalone',annual=('Mar 2015',),quarters=('Mar 2015',),value='99')):
            session,result=self.scrape(page(annual=('Mar 2026',)),standalone)
            self.assertEqual(result['view'],'standalone');self.assertEqual(len(session.calls),2)
            self.assertIn('Selected view lacks recent annual or quarterly coverage',result['warnings'])
            self.assertIn(result['profit_loss']['annual'][0]['net_profit'],(88,99))
    def test_standalone_404_or_no_usable_retains_original_consolidated(self):
        for status,body in ((404,''),(200,page('standalone',annual=(),quarters=()))):
            session,result=self.scrape(page(annual=('Mar 2026',),value='42'),body,statuses=(200,status))
            self.assertEqual(len(session.calls),2);self.assertEqual(result['view'],'consolidated')
            self.assertEqual(result['profit_loss']['annual'][0]['net_profit'],42)
            self.assertIn('Standalone unavailable; retained available consolidated financials',result['warnings'])
    def test_neither_view_has_numeric_financials_fails(self):
        session=Session(lambda u,k:(200,page(annual=(),quarters=()),None))
        with patch.object(m,'datetime',FixedDatetime),self.assertRaisesRegex(m.NotFound,'no auto company page with usable financial data'):m.scrape(session,'TEST')
        self.assertEqual(len(session.calls),2)
    def test_operational_or_identity_bad_fallback_is_not_availability(self):
        for status,body,expected in ((403,'', 'HTTP 403'),(200,page('standalone',code='OTHER'),'Identity mismatch'),(200,'<h1>Challenge</h1>','Unexpected company-page')):
            session=Session(lambda u,k:(200,page(annual=('Mar 2026',)),None) if '/consolidated/' in u else(status,body,None))
            with patch.object(m,'datetime',FixedDatetime),self.assertRaisesRegex(m.ScrapeError,expected):m.scrape(session,'TEST')
            self.assertEqual(len(session.calls),2)
    def test_standalone_view_link_is_not_selected_consolidated_view(self):
        from bs4 import BeautifulSoup
        for selected, opposite in [('standalone','consolidated'),('consolidated','standalone')]:
            soup=BeautifulSoup(page(selected),'html.parser');del soup.select_one('#company-info')['data-consolidated']
            soup.select_one('#profit-loss p').append(BeautifulSoup('<a href="/other/">View '+opposite.title()+'</a>','html.parser'))
            self.assertEqual(m.parse_company(str(soup))['_view'],selected)
    def test_explicit_view_flag_overrides_switch_link_label(self):
        from bs4 import BeautifulSoup
        soup=BeautifulSoup(page('standalone'),'html.parser');soup.select_one('#profit-loss p').append(BeautifulSoup('<a href="/other/">View Consolidated</a>','html.parser'))
        self.assertEqual(m.parse_company(str(soup))['_view'],'standalone')
    def test_real_standalone_aubank_and_vst_view_headers(self):
        for symbol in ('AUBANK','VSTIND'):
            html=(FIX/(symbol+'.standalone-sections.html')).read_text()
            self.assertEqual(m.parse_company(html)['_view'],'standalone')
            session=Session(lambda u,k:(200,html,None))
            with patch.object(m,'datetime',FixedDatetime):result=m.scrape(session,symbol,view='standalone')
            self.assertEqual(result['view'],'standalone');self.assertEqual(len(session.calls),1)

    def test_explicit_view_bypasses_recency_gate(self):
        for view in ('consolidated','standalone'):
            session=Session(lambda u,k:(200,page(view,annual=('Mar 2015',),quarters=()),None))
            with patch.object(m,'datetime',FixedDatetime):result=m.scrape(session,'TEST',view=view)
            self.assertEqual(result['view'],view);self.assertEqual(len(session.calls),1)
