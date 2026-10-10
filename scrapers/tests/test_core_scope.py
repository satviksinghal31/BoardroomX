"""Main-page-only fetch and stable JSON contract."""
import copy
import json
import unittest
from unittest.mock import patch
from test_scraper import FIX, Session, m, FixtureDatetime

class CoreScopeTests(unittest.TestCase):
    def setUp(self):
        clock=patch.object(m,"datetime",FixtureDatetime);clock.start();self.addCleanup(clock.stop)
    def test_one_company_page_and_no_api_calls(self):
        page=(FIX/'RELIANCE.consolidated.html').read_text()
        session=Session(lambda url,kwargs:(200,page,None))
        data=m.scrape(session,'RELIANCE')
        self.assertEqual(session.calls,['https://www.screener.in/company/RELIANCE/consolidated/'])
        self.assertNotIn('peers',data)
        self.assertNotIn('scope',data)
        self.assertNotIn('schema_version',data)
        self.assertEqual(json.loads(json.dumps(data,allow_nan=False)),data)
    def test_invalid_json_contract_is_rejected(self):
        with self.assertRaises(m.ScrapeError):m.validate_company({'symbol':'RELIANCE'})
    def test_nonfinite_payload_is_rejected(self):
        page=(FIX/'RELIANCE.consolidated.html').read_text()
        data=m.scrape(Session(lambda u,k:(200,page,None)),'RELIANCE')
        data['key_ratios']['price']=float('nan')
        with self.assertRaises(m.ScrapeError):m.validate_company(data)

if __name__=='__main__':unittest.main()
