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
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertEqual(x['view'],'consolidated');self.assertFalse(any(u.endswith('/RELIANCE/') for u in s.calls))
 def test_fallback_when_consolidated_missing(self):
  s=Session(lambda u,k:(404,'',None) if '/consolidated/' in u else (200,self.peers if '/peers/' in u else self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertEqual(x['view'],'standalone')
 def test_sparse_consolidated_history_does_not_fetch_standalone(self):
  html=(FIX/'ATHERENERG.consolidated.html').read_text()
  s=Session(lambda u,k:(200,self.peers if '/peers/' in u else html,None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'ATHERENERG',details=False,pause=0)
  self.assertEqual(len(x['profit_loss']['annual']),1);self.assertEqual(x['view'],'consolidated')
  self.assertFalse(any(u.endswith('/ATHERENERG/') for u in s.calls))
 def test_fallback_when_consolidated_has_no_numeric_financials(self):
  from bs4 import BeautifulSoup
  page=BeautifulSoup(self.html,'html.parser');page.select_one('#profit-loss').decompose()
  s=Session(lambda u,k:(200,str(page),None) if '/consolidated/' in u else (200,self.peers if '/peers/' in u else self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertEqual(x['view'],'standalone');self.assertEqual(x['fallback_reason'],'consolidated_has_no_usable_financials')
 def test_http403_is_controlled_and_does_not_fallback(self):
  s=Session(lambda u,k:(403,'Forbidden',None))
  with patch.object(m.time,'sleep'):
   with self.assertRaises(RuntimeError):m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertEqual(len(s.calls),1)
 def test_optional_peers_failure_returns_financials(self):
  s=Session(lambda u,k:(503,'Unavailable',None) if '/api/' in u else (200,self.html,None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertTrue(x['profit_loss']['annual']);self.assertIsNone(x['peers']);self.assertTrue(x['warnings'])
 def test_redirect_view_and_canonical_identifier(self):
  s=Session(lambda u,k:(200,self.peers,None) if '/api/' in u else (200,self.html.replace('data-consolidated="true"','').replace('Consolidated','Standalone'),'https://www.screener.in/company/500325/'))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'500325',details=False,pause=0)
  self.assertEqual(x['view'],'standalone');self.assertEqual(x['symbol'],'RELIANCE');self.assertEqual(x['requested_identifier'],'500325');self.assertEqual(x['source_url'],'https://www.screener.in/company/500325/')
 def test_public_details_and_company_id(self):
  def route(u,k):
   if '/peers/' in u:return 200,self.peers,None
   if '/schedules/' in u:return 200,(FIX/'interaction_borrowings.response').read_text(),None
   if '/investors/' in u:return 200,(FIX/'interaction_shareholders.response').read_text(),None
   return 200,self.html,None
  s=Session(route)
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',pause=0)
  group=x['schedules']['balance_sheet']['borrowings'];self.assertEqual(group['periods'][-1]['long_term_borrowings'],270751);self.assertEqual(x['holders']['quarterly']['promoters']['holders'][0]['holdings'][-1]['holding_pct'],11.12)
  self.assertTrue(all('/2726/' in u for u in s.calls if '/schedules/' in u or '/investors/' in u));self.assertTrue(any('consolidated=' in u for u in s.calls if '/schedules/' in u))
 def test_malformed_optional_peers_do_not_discard_financials(self):
  s=Session(lambda u,k:(200,'<table></table>' if '/peers/' in u else self.html,None))
  with patch.object(m.time,'sleep'):x=m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertTrue(x['profit_loss']['annual']);self.assertIsNone(x['peers']);self.assertTrue(x['warnings'])
 def test_unexpected_html_is_error_not_standalone_fallback(self):
  s=Session(lambda u,k:(200,'<h1>Verify you are human</h1>',None))
  with patch.object(m.time,'sleep'):
   with self.assertRaises(RuntimeError):m.scrape(s,'RELIANCE',details=False,pause=0)
  self.assertEqual(len(s.calls),1)
 def test_preserve_existing_financial_cells_eight_companies(self):
  for sym in ['RELIANCE','HDFCBANK','CARBORUNIV','SHILPAMED','526299','ATHERENERG','HESTERBIO','531494']:
   old=json.loads((FIX/f'{sym}.json').read_text());view=old['view'];new=m.parse_company((FIX/f'{sym}.{view}.html').read_text())
   for field in ['quarterly_results','balance_sheet','cash_flow','ratios']:
    self.assertEqual([{k:v for k,v in n.items() if k!='raw_pdf_url'} for n in new[field]],old[field],(sym,field))
   self.assertEqual(new['profit_loss'],old['profit_loss']);self.assertEqual(new['shareholding'],old['shareholding']);self.assertEqual(new['key_ratios'],old['key_ratios'])
if __name__=='__main__':unittest.main()
