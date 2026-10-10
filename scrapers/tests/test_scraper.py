import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse,parse_qs
import requests
ROOT=Path(__file__).resolve().parents[1];FIX=Path(__file__).resolve().parent/'fixtures'
spec=importlib.util.spec_from_file_location('scraper',ROOT/'boardroom_screener_scraper.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Session(requests.Session):
 def __init__(self,routes):super().__init__();self.routes=routes;self.calls=[]
 def get(self,url,**kwargs):
  self.calls.append(url);status,body,final=self.routes(url,kwargs);r=requests.Response();r.status_code=status;r._content=body.encode();r.url=final or url;r.encoding='utf8';return r
class Tests(unittest.TestCase):
 def setUp(self):self.html=(FIX/'RELIANCE.consolidated.html').read_text();self.peers=(FIX/'RELIANCE.peers.html').read_text()
 def test_duration_suffix_periods_keep_actual_month_end(self):
  for period, expected in [('Mar 2023 15m','2023-03-31'),('Jun 2015 15m','2015-06-30'),('Mar 2016 9m','2016-03-31'),('Mar 2024 8m','2024-03-31'),('Mar 2015 18m','2015-03-31'),('Feb 2024 12m','2024-02-29')]:
   with self.subTest(period=period):self.assertEqual(m.period_end(period),expected)
 def test_malformed_duration_suffix_periods_rejected(self):
  for period in ['Mar 2023 0m','Mar 2023 -9m','Mar 2023 9months','Mar 2023 9m extra','Mar 2023 1.5m','Foo 2023 15m','Mar 0000 15m','TTM 12m']:
   with self.subTest(period=period):self.assertIsNone(m.period_end(period))
 def test_duration_suffix_retained_without_unrecognized_period_warning(self):
  html='<section id="profit-loss"><table><tr><th></th><th>Mar 2023 15m</th></tr><tr><td>Sales</td><td>42</td></tr></table></section>'
  data=m.parse_company(html)
  self.assertEqual(data['profit_loss']['annual'],[{'period':'Mar 2023 15m','period_end':'2023-03-31','sales':42}])
  self.assertTrue(m.has_financials(data));self.assertFalse(any('Unrecognized table period' in w for w in data['warnings']))
 def test_concall_all_links_and_date(self):
  x=m.parse_company(self.html)['documents']['concalls'];self.assertEqual(x[0]['period'],'Jul 2026');self.assertEqual(sum(len(a['links']) for a in x),67)
 def test_raw_results_absolute_links(self):
  x=m.parse_company(self.html)['quarterly_results'];self.assertEqual(x[0]['raw_pdf_url'],'https://www.screener.in/company/source/quarter/2726/6/2023/')
 def test_document_metadata(self):
  x=m.parse_company(self.html)['documents'];self.assertEqual(x['announcements'][0]['date'],'2026-10-07T22:36:04+05:30');self.assertEqual(x['annual_reports'][0]['source'],'bse');self.assertEqual(x['credit_ratings'][0]['date_text'],'30 Sep');self.assertEqual(x['credit_ratings'][0]['source'],'crisil')
 def test_profile_citation_links_and_preview(self):
  x=m.parse_company(self.html)['profile'];self.assertTrue(x['key_points_is_preview']);self.assertTrue(x['references']['key_points'][0]['url'].endswith('#page=169'))
 def test_empty_financials_rejected(self):
  for rows in ['', '<tr><td>Sales</td><td>x,xxx</td></tr>']:
   x=m.parse_company('<section id="profit-loss"><table><tr><th></th><th>Mar 2026</th></tr>'+rows+'</table></section>');self.assertFalse(m.has_financials(x))
 def test_units(self):
  x=m.parse_company(self.html);self.assertEqual(x['units']['shareholding']['quarterly']['promoters'],'percent');self.assertEqual(x['units']['shareholding']['quarterly']['no_of_shareholders'],'count');self.assertEqual(x['units']['quarterly_results']['eps_in_rs'],'INR/share')
 def test_profit_for_eps_is_aggregate_money_not_per_share(self):
  self.assertEqual(m.metric_unit('Profit for EPS','profit-loss'),'INR crore')
  self.assertEqual(m.metric_unit('EPS in Rs','profit-loss'),'INR/share')
 def test_default_never_fetches_standalone_when_consolidated_valid(self):
  s=Session(lambda u,k:(200,self.peers if '/peers/' in u else self.html,None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',pause=0)
  self.assertEqual(x['view'],'consolidated');self.assertFalse(any(u.endswith('/RELIANCE/') for u in s.calls))
 def test_fallback_when_consolidated_missing(self):
  s=Session(lambda u,k:(404,'',None) if '/consolidated/' in u else (200,self.peers if '/peers/' in u else self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',pause=0)
  self.assertEqual(x['view'],'standalone')
 def test_sparse_consolidated_history_does_not_fetch_standalone(self):
  html=(FIX/'ATHERENERG.consolidated.html').read_text()
  s=Session(lambda u,k:(200,self.peers if '/peers/' in u else html,None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'ATHERENERG',pause=0)
  self.assertEqual(len(x['profit_loss']['annual']),1);self.assertEqual(x['view'],'consolidated')
  self.assertFalse(any(u.endswith('/ATHERENERG/') for u in s.calls))
 def test_fallback_when_consolidated_has_no_numeric_financials(self):
  from bs4 import BeautifulSoup
  page=BeautifulSoup(self.html,'html.parser');page.select_one('#profit-loss').decompose()
  s=Session(lambda u,k:(200,str(page),None) if '/consolidated/' in u else (200,self.peers if '/peers/' in u else self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',pause=0)
  self.assertEqual(x['view'],'standalone');self.assertEqual(x['fallback_reason'],'consolidated_has_no_usable_financials')
 def test_http403_is_controlled_and_does_not_fallback(self):
  s=Session(lambda u,k:(403,'Forbidden',None))
  with patch.object(m.time,'sleep'):
   with self.assertRaises(RuntimeError):m.scrape(s,'RELIANCE',pause=0)
  self.assertEqual(len(s.calls),1)
 def test_redirect_view_and_canonical_identifier(self):
  s=Session(lambda u,k:(200,self.peers,None) if '/api/' in u else (200,self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),'https://www.screener.in/company/500325/'))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'500325',pause=0)
  self.assertEqual(x['view'],'standalone');self.assertEqual(x['symbol'],'RELIANCE');self.assertEqual(x['requested_identifier'],'500325');self.assertEqual(x['source_url'],'https://www.screener.in/company/500325/')
 def test_unexpected_html_is_error_not_standalone_fallback(self):
  s=Session(lambda u,k:(200,'<h1>Verify you are human</h1>',None))
  with patch.object(m.time,'sleep'):
   with self.assertRaises(RuntimeError):m.scrape(s,'RELIANCE',pause=0)
  self.assertEqual(len(s.calls),1)
 def test_preserve_existing_financial_cells_eight_companies(self):
  for sym in ['RELIANCE','HDFCBANK','CARBORUNIV','SHILPAMED','526299','ATHERENERG','HESTERBIO','531494']:
   old=json.loads((FIX/f'{sym}.json').read_text());view=old['view'];new=m.parse_company((FIX/f'{sym}.{view}.html').read_text())
   for field in ['quarterly_results','balance_sheet','cash_flow','ratios']:
    self.assertEqual([{k:v for k,v in n.items() if k!='raw_pdf_url'} for n in new[field]],old[field],(sym,field))
   self.assertEqual(new['profit_loss'],old['profit_loss']);self.assertEqual(new['shareholding'],old['shareholding']);self.assertEqual(new['key_ratios'],old['key_ratios'])
if __name__=='__main__':unittest.main()
