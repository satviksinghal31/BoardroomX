"""Offline resilience QA. Every HTTP request and sleep is replaced locally."""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import patch
import requests

ROOT = Path(__file__).resolve().parents[1]
FIX = Path(__file__).resolve().parent / 'fixtures'
spec = importlib.util.spec_from_file_location('resilience_scraper', ROOT / 'boardroom_screener_scraper.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def response(status=200, body='', url='https://www.screener.in/company/RELIANCE/consolidated/', headers=None):
    r = requests.Response()
    r.status_code, r._content, r.url, r.encoding = status, body.encode(), url, 'utf8'
    r.headers.update(headers or {})
    return r

class Session:
    def __init__(self, route): self.route, self.calls = route, []
    def get(self, url, **kw):
        self.calls.append((url, kw))
        result = self.route(url, len(self.calls))
        if isinstance(result, Exception): raise result
        return result

class ResilienceQA(unittest.TestCase):
    def setUp(self):
        self.html = (FIX / 'RELIANCE.consolidated.html').read_text()
        self.sleep = patch.object(m.time, 'sleep').start()
        self.addCleanup(patch.stopall)
    def test_operational_failures_never_fallback_and_are_bounded(self):
        for failure, attempts in [(requests.Timeout('timeout'),3), (requests.ConnectionError('disconnect'),3), (403,1), (429,3), (500,3), (503,3)]:
            with self.subTest(failure=failure):
                s = Session(lambda u,n: response(failure,url=u) if isinstance(failure,int) else failure)
                with self.assertRaises(m.ScrapeError): m.scrape(s,'RELIANCE',pause=0)
                self.assertEqual(len(s.calls), attempts)
                self.assertTrue(all('/consolidated/' in u for u,k in s.calls))
                self.assertTrue(all(k['timeout']==30 for u,k in s.calls))
    def test_404_tries_standalone_once(self):
        s = Session(lambda u,n: response(404,url=u))
        with self.assertRaises(m.NotFound): m.scrape(s,'RELIANCE',pause=0)
        self.assertEqual(len(s.calls),2)
    def test_retry_after_seconds_and_http_date(self):
        for header in ['7',format_datetime(datetime.now(timezone.utc)+timedelta(seconds=7),usegmt=True)]:
            with self.subTest(header=header):
                self.sleep.reset_mock()
                s=Session(lambda u,n:response(429 if n==1 else 200,url=u,headers={'Retry-After':header}))
                m.Client(s,0).get('https://www.screener.in/a')
                first=self.sleep.call_args_list[0].args[0]
                self.assertGreater(first,5)
                self.assertLessEqual(first,7)
    def test_pacing_between_starts(self):
        s=Session(lambda u,n:response(url=u))
        with patch.object(m.time,'monotonic',side_effect=[10,10.25,10.25]):
            c=m.Client(s,1); c.get('a'); c.get('b')
        self.sleep.assert_called_once_with(.75)
    def test_login_redirect_is_error_without_fallback(self):
        s=Session(lambda u,n:response(body=self.html,url='https://www.screener.in/login/'))
        with self.assertRaises(m.ScrapeError):m.scrape(s,'RELIANCE',pause=0)
        self.assertEqual(len(s.calls),1)
    def test_cli_fetch_failure_returns_one_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'RELIANCE.json';p.write_text('previous good data')
            with patch.object(m,'fetch_company',side_effect=m.ScrapeError('503')):
                self.assertEqual(m.main(['RELIANCE','--out',d]),1)
            self.assertEqual(p.read_text(),'previous good data')
    def test_retry_after_has_reasonable_upper_bound(self):
        s=Session(lambda u,n:response(429 if n==1 else 200,url=u,headers={'Retry-After':'2147483647'}))
        with self.assertRaises(m.ScrapeError):
            m.Client(s,0).get('https://www.screener.in/a')
        self.assertEqual(len(s.calls),1)
        self.sleep.assert_not_called()
    def test_bot_page_with_company_heading_does_not_trigger_standalone(self):
        bot='<section id="top"><h1>Verify you are human</h1></section><p>Security challenge</p>'
        s=Session(lambda u,n:response(body=bot if n==1 else self.html.replace('data-consolidated="true"','data-consolidated="false"'),url=u))
        with self.assertRaises(m.ScrapeError):m.scrape(s,'RELIANCE',pause=0)
        self.assertEqual(len(s.calls),1)
    def test_failed_file_refresh_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'RELIANCE.json';p.write_text('previous good data')
            def failed_write(path,*args,**kwargs):
                with path.open('w') as stream:stream.write('{partial')
                raise OSError('disk full')
            with patch.object(m,'fetch_company',return_value={'requested_identifier':'RELIANCE','symbol':'RELIANCE','view':'consolidated','warnings':[]}),patch.object(Path,'write_text',failed_write):
                self.assertEqual(m.main(['RELIANCE','--out',d]),1)
            self.assertEqual(p.read_text(),'previous good data')

if __name__=='__main__':unittest.main()
