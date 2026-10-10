"""Lean conversion preserves source rows, identity and every non-AI attachment."""
import copy
import unittest
from test_scraper import FIX, Session, m

class StandardJsonTests(unittest.TestCase):
    def test_legacy_conversion_is_pure_idempotent_and_preserves_identity_financials(self):
        legacy={'symbol':'TCS','company_id':'42','profile':{'website':'https://tcs.com','nse_code':'TCS','bse_code':'532540'},'profit_loss':{'annual':[{'period':'Mar 2025','period_end':'2025-03-31','sales':123}]},'warnings':['Source warning'],'documents':{},'schema_version':'1','parser_version':'4','scope':'old','requested_identifier':'TCS','requested_url':'url','warehouse_id':'99','history':{},'freshness':{},'document_scope':{},'other_features':[]}
        original=copy.deepcopy(legacy); lean=m.to_standard_json(legacy)
        self.assertEqual(legacy,original);self.assertEqual(m.to_standard_json(lean),lean)
        for key in ('symbol','company_id','profile','profit_loss','warnings'):self.assertEqual(lean[key],legacy[key])
        for key in ('schema_version','parser_version','scope','requested_identifier','requested_url','warehouse_id','history','freshness','document_scope','other_features'):self.assertNotIn(key,lean)
    def test_concall_rows_and_duplicate_unknown_links_survive_without_ai_summary(self):
        links=[{'type':'Transcript','url':'transcript1'},{'type':'Transcript','url':'transcript2'},{'type':'PPT','url':'slides'},{'type':'Recording','url':'audio'},{'type':'Attachment','url':'other'},{'type':'AI Summary','url':'ai'}]
        payload={'documents':{'concalls':[{'period':'Jul 2026','links':links},{'period':'Jul 2026','links':[{'type':'PPT','url':'slides2'}]}]}}
        data=m.to_standard_json(payload);rows=data['documents']['concalls']
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['transcript_url'],'transcript1');self.assertEqual(rows[0]['presentation_url'],'slides');self.assertEqual(rows[0]['recording_url'],'audio')
        self.assertEqual(rows[0]['additional_links'],[{'type':'Transcript','url':'transcript2'},{'type':'Attachment','url':'other'}]);self.assertIsNone(rows[1]['transcript_url'])
        self.assertEqual(m.to_standard_json(data),data)
    def test_ai_only_concall_never_reappears_through_primary_url(self):
        for title in ('AI Summary', 'Call notes'):
            raw={'documents':{'concalls':[{'period':'Jul 2026','title':title,'url':'https://example.com/ai','links':[{'type':'AI Summary','url':'https://example.com/ai'}]}]}}
            self.assertEqual(m.to_standard_json(raw)['documents']['concalls'],[{'period':'Jul 2026','transcript_url':None,'presentation_url':None,'recording_url':None}])
    def test_concall_without_clickable_links_retains_display_row(self):
        html='<section id="documents"><div class="documents"><h3>Concalls</h3><ul class="list-links"><li><div>Jul 2026</div><div>Transcript</div></li><li><div>Jul 2026</div></li></ul></div></section>'
        rows=m.parse_company(html)['documents']['concalls']
        self.assertEqual(len(rows),2);self.assertTrue(all(row=={'period':'Jul 2026','transcript_url':None,'presentation_url':None,'recording_url':None} for row in rows))
    def test_same_primary_url_additional_attachment_retains_idempotency(self):
        raw={'documents':{'annual_reports':[{'year':2025,'source':'bse','url':'report','links':[{'type':'Report','url':'report'},{'type':'Annex','url':'report'}]}]}}
        lean=m.to_standard_json(raw);self.assertEqual(lean['documents']['annual_reports'][0]['additional_links'],[{'type':'Annex','url':'report'}]);self.assertEqual(m.to_standard_json(lean),lean)

    def test_nonconcall_ai_primary_replaced_or_row_omitted(self):
        for section in ('annual_reports','credit_ratings','announcements'):
            for title in ('AI Summary','Document'):
                raw={'documents':{section:[{'year':2025,'date':None,'date_text':None,'source':'bse','title':title,'url':'ai','links':[{'type':'AI Summary','url':'ai'},{'type':'Attachment','url':'real1'},{'type':'Annex','url':'real2'}]}]}}
                lean=m.to_standard_json(raw);rows=lean['documents'][section]
                self.assertEqual(rows[0]['url'],'real1')
                self.assertEqual(rows[0]['additional_links'],[{'type':'Annex','url':'real2'}])
                self.assertEqual(m.to_standard_json(lean),lean)
                raw['documents'][section][0]['links']=[{'type':'AI Summary','url':'ai'}]
                self.assertEqual(m.to_standard_json(raw)['documents'][section],[])

    def test_full_fetch_is_lean_and_validated_with_no_extra_requests(self):
        page=(FIX/'RELIANCE.consolidated.html').read_text();session=Session(lambda u,k:(200,page,None))
        data=m.scrape(session,'RELIANCE');m.validate_company(data)
        self.assertEqual(len(session.calls),1);self.assertEqual(data,m.to_standard_json(data))
        self.assertNotIn('history',data);self.assertNotIn('freshness',data);self.assertIn('company_id',data)
    def test_document_dates_are_not_invented_and_other_attachments_preserved(self):
        raw={'documents':{'annual_reports':[{'year':2025,'source':'bse','url':'annual','links':[{'type':'Report','url':'annual'},{'type':'Annex','url':'annex'}]}],'credit_ratings':[{'date':None,'date_text':'30 Sep','source':'crisil','url':'rating'}],'announcements':[{'date':None,'title':'Notice','detail':'Detail','url':'notice'}]}}
        docs=m.to_standard_json(raw)['documents'];self.assertEqual(docs['credit_ratings'][0],{'date':None,'date_text':'30 Sep','agency':'crisil','url':'rating'})
        self.assertEqual(docs['announcements'][0]['description'],'Detail');self.assertIsNone(docs['announcements'][0]['date']);self.assertEqual(docs['annual_reports'][0]['additional_links'],[{'type':'Annex','url':'annex'}])
