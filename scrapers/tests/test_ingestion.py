import copy
import importlib.util
import unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

SPEC = importlib.util.spec_from_file_location('ingest', Path(__file__).parents[1] / 'ingest.py')
if SPEC:
    ingest = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(ingest)


def payload(symbol='TCS', warnings=None):
    return {
        'symbol': symbol, 'company_id': '1', 'name': symbol,
        'view': 'standalone', 'source_url': 'https://www.screener.in/company/'+symbol+'/',
        'scraped_at': '2026-10-09T00:00:00+00:00', 'fallback_reason': None,
        'profile': {'nse_code': symbol, 'bse_code': None, 'website': None},
        'key_ratios': {}, 'shareholding': {'quarterly': None, 'yearly': None},
        'documents': {'annual_reports': [], 'concalls': [], 'credit_ratings': [], 'announcements': []},
        'units': {}, 'warnings': warnings or [],
        'profit_loss': {'growth': {}, 'annual': [{'period': 'Mar 2025', 'period_end': '2025-03-31', 'net_profit': 1}]},
        'quarterly_results': [{'period': 'Mar 2025', 'period_end': '2025-03-31', 'net_profit': 1}],
        'balance_sheet': [{'period': 'Mar 2025', 'period_end': '2025-03-31', 'total_assets': 1}],
        'cash_flow': [{'period': 'Mar 2025', 'period_end': '2025-03-31', 'cash_from_operating_activity': 1}],
        'ratios': [{'period': 'Mar 2025', 'period_end': '2025-03-31', 'roce_pct': 1}],
    }


def legacy_payload(symbol='TCS'):
    return dict(payload(symbol), requested_identifier=symbol, requested_url='old requested URL',
                parser_version='4.0.0', schema_version='1.0.0', scope='company_page',
                warehouse_id='legacy-id', history={'short_history': True}, freshness={'old': True},
                document_scope={'announcements': 'recent'}, other_features=['old metadata'])


class MemoryStore:
    def __init__(self, rows):
        self.rows = rows
        self.control = {'state': 'ready', 'pilot_verified': True, 'last_company_start': None, 'pause_until': None, 'processed_in_batch': 0, 'batch_number': 1, 'started_at': 0, 'error': None}
    def update_control(self, **values): self.control.update(values)
    def recover(self):
        for r in self.rows:
            if r['status'] == 'fetching': r['status'] = 'failed'
    def candidates(self, pilot):
        return sorted([r for r in self.rows if r['pilot'] == pilot and r['status'] != 'complete' and r['attempts'] < 2 and not (r['status'] == 'partial' and (r.get('last_error') or '').startswith('Source data unavailable in selected view: '))], key=lambda r: (r['attempts'], r['symbol']))
    def begin(self, row, now):
        row.update(status='fetching', attempts=row['attempts'] + 1)
        self.update_control(last_company_start=now, processed_in_batch=self.control['processed_in_batch'] + 1)
    def finish(self, row, status, data, error, now):
        if data is not None: row['data'] = copy.deepcopy(data)
        row.update(status=status, last_error=error)
        return copy.deepcopy(row.get('data'))
    def counts(self):
        return {k: sum(r['status'] == k for r in self.rows) for k in ('complete', 'partial', 'failed', 'pending', 'fetching')} | {'total': len(self.rows)}


def row(symbol='TCS', **kwargs):
    return dict(dict(symbol=symbol, screener_identifier=symbol, pilot=False, attempts=0, status='pending', data=None), **kwargs)


class Clock:
    def __init__(self): self.now = 1000; self.sleeps = []
    def time(self): return self.now
    def sleep(self, n): self.sleeps.append(n); self.now += n


class IngestionTests(unittest.TestCase):
    def test_exact_payload_complete_and_short_history_allowed(self):
        data = payload(warnings=['Fewer than five annual periods in selected view; accounting views were not mixed'])
        self.assertEqual(ingest.assess(data, 'TCS'), ('complete', None))
    def test_identity_mismatch_fails(self):
        with self.assertRaises(ValueError): ingest.assess(payload('OTHER'), 'TCS')
    def test_optional_block_stops_before_next_company(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock(); calls = []
        def fetch(symbol, **kw): calls.append(symbol); return payload(symbol, ['HTTP 429 for https://www.screener.in/api/'])
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['A']); self.assertEqual(store.control['state'], 'paused')
    def test_durable_spacing_and_batch_checkpoint(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock()
        store.control.update(last_company_start=999, processed_in_batch=49)
        starts = []
        def fetch(symbol, **kw): starts.append(clock.now); return payload(symbol)
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(starts, [1001, 1003]); self.assertEqual(store.control['batch_number'], 2)
    def test_retry_after_first_pass_preserves_better_payload(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol)
            if calls.count(symbol) == 2: raise RuntimeError('bad page')
            return payload(symbol, ['Malformed growth table row'])
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['A', 'B', 'A', 'B']); self.assertEqual(store.rows[0]['data'], payload('A', ['Malformed growth table row']))
        self.assertEqual(store.rows[0]['status'], 'partial')
    def test_selected_standalone_fallback_replaces_stale_consolidated_despite_fewer_rows(self):
        for reason in ('consolidated_missing_recent_financials', 'consolidated_has_no_usable_financials', 'consolidated_not_found', 'consolidated_unavailable'):
            with self.subTest(reason=reason):
                previous = payload(); previous['view'] = 'consolidated'; previous['source_url'] += 'consolidated/'
                previous['profit_loss']['annual'] = [dict(previous['profit_loss']['annual'][0], period=f'Mar {year}', period_end=f'{year}-03-31') for year in range(2000, 2012)]
                fresh = payload(); fresh['balance_sheet'] = None
                fresh['fallback_reason'] = reason
                fresh['warnings'] = ['No reporting periods in source table: balance_sheet']
                self.assertGreater(ingest.quality(previous), ingest.quality(fresh))
                store = MemoryStore([row(data=previous)]); clock = Clock()
                ingest.Worker(store, lambda *a, **kw: copy.deepcopy(fresh), clock.time, clock.sleep, lambda x: None).run(False)
                self.assertEqual(store.rows[0]['data'], fresh)
                self.assertEqual(store.rows[0]['status'], 'partial')
                self.assertEqual(store.rows[0]['last_error'], 'Source data unavailable in selected view: balance_sheet')
                self.assertEqual(store.rows[0]['attempts'], 1)

    def test_json_roundtrip_mismatch_stops_worker(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock()
        store.finish = lambda *args: {'lost': 'data'}
        with self.assertRaisesRegex(RuntimeError, 'roundtrip'):
            ingest.Worker(store, lambda s, **kw: payload(s), clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(store.rows[1]['attempts'], 0)
    def test_required_financial_structure_rejected(self):
        data = payload(); del data['profit_loss']['growth']
        with self.assertRaises(Exception): ingest.assess(data, 'TCS')
    def test_network_error_pauses_and_preserves_previous_data(self):
        store = MemoryStore([row()]); store.rows[0]['data'] = payload(); clock = Clock()
        def fetch(*a, **kw): raise RuntimeError('Network error for company')
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(store.control['state'], 'paused')
        self.assertEqual(store.rows[0]['data'], payload())
    def test_fresh_legacy_payload_normalizes_without_extra_fetches(self):
        store = MemoryStore([row()]); clock = Clock(); calls = []
        def fetch(symbol, **kw): calls.append((symbol, kw)); return legacy_payload(symbol)
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, [('TCS', {'pause': 0})])
        self.assertEqual(store.rows[0]['data'], payload())
        self.assertEqual(store.rows[0]['status'], 'complete')
        self.assertIsNone(store.rows[0]['last_error'])

    def test_failed_refresh_retains_lean_legacy_data_and_failure_status(self):
        old = legacy_payload(); store = MemoryStore([row(data=old)]); clock = Clock(); calls = []
        def fetch(symbol, **kw): calls.append(symbol); raise RuntimeError('bad company page')
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['TCS', 'TCS'])
        self.assertEqual(store.rows[0]['data'], payload())
        self.assertEqual(store.rows[0]['status'], 'partial')
        self.assertEqual(store.rows[0]['attempts'], 2)
        self.assertEqual(store.rows[0]['last_error'], 'bad company page')
        self.assertEqual(store.control['state'], 'completed_with_failures')
        self.assertIn('history', old)

    def test_partial_refresh_compares_normalized_legacy_data(self):
        store = MemoryStore([row(data=legacy_payload())]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol); fresh = payload(symbol); fresh['balance_sheet'] = []; return fresh
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['TCS', 'TCS'])
        self.assertEqual(store.rows[0]['data'], payload())
        self.assertEqual(store.rows[0]['status'], 'partial')
        self.assertIn('balance_sheet', store.rows[0]['last_error'])

    def test_complete_row_never_fetched(self):
        store = MemoryStore([row(status='complete')]); clock = Clock()
        def fetch(*a, **kw): self.fail('Complete row was fetched')
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)

    def test_retry_after_sets_durable_pause(self):
        store = MemoryStore([row()]); clock = Clock()
        def fetch(*a, **kw):
            exc = RuntimeError('HTTP 429'); exc.retry_after = 600; raise exc
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(store.control['pause_until'], 1600)
    def test_lock_health_checked_before_fetch(self):
        store = MemoryStore([row()]); clock = Clock()
        def check(): raise RuntimeError('Lost worker lock connection')
        store.check_lock = check
        with self.assertRaises(RuntimeError):
            ingest.Worker(store, lambda *a, **kw: self.fail('Fetched after lost lock'), clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(store.control['state'], 'paused')
    def test_resume_rejects_early_retry(self):
        store = MemoryStore([row()]); store.control['pause_until'] = 1600
        with self.assertRaises(ValueError): ingest.resume(store, 1000)

    def test_empty_required_financial_tables_are_partial(self):
        for key in ('quarterly_results', 'balance_sheet', 'cash_flow', 'ratios'):
            data = payload(); data[key] = []
            self.assertEqual(ingest.assess(data, 'TCS')[0], 'partial', key)
    def test_malformed_payload_with_block_warning_stops_immediately(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol); data = payload(symbol, ['HTTP 429 for company']); del data['name']; return data
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['A']); self.assertEqual(store.control['state'], 'paused')

    def test_unexpected_company_page_pauses_before_next_symbol(self):
        from boardroom_screener_scraper import ScrapeError
        previous = payload('A')
        store = MemoryStore([row('A', data=previous), row('B')]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol)
            raise ScrapeError(f'Unexpected company-page response for https://www.screener.in/company/{symbol}/; financial availability is unknown')
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['A'])
        self.assertEqual(store.control['state'], 'paused')
        self.assertEqual(store.rows[0]['data'], previous)
        self.assertEqual(store.rows[0]['attempts'], 1)
        self.assertEqual(store.rows[1]['attempts'], 0)
        self.assertIn('Unexpected company-page response', store.control['error'])

    def test_symbol_specific_scrape_error_retries_without_global_pause(self):
        from boardroom_screener_scraper import ScrapeError
        store = MemoryStore([row('A'), row('B')]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol)
            if symbol == 'A': raise ScrapeError('Invalid company JSON: financial period/date structure')
            return payload(symbol)
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['A', 'B', 'A'])
        self.assertEqual(store.control['state'], 'completed_with_failures')
        self.assertEqual(store.rows[0]['attempts'], 2)
        self.assertEqual(store.rows[1]['status'], 'complete')

    def test_confirmed_source_empty_is_partial_without_same_run_retry(self):
        store = MemoryStore([row('A'), row('B')]); clock = Clock(); calls = []; reports = []
        def fetch(symbol, **kw):
            calls.append(symbol); data = payload(symbol)
            if symbol == 'A':
                data['quarterly_results'] = None
                data['warnings'] = ['No reporting periods in source table: quarterly_results']
            return data
        ingest.Worker(store, fetch, clock.time, clock.sleep, reports.append).run(False)
        self.assertEqual(calls, ['A', 'B'])
        self.assertEqual(store.rows[0]['status'], 'partial')
        self.assertEqual(store.rows[0]['attempts'], 1)
        self.assertIsNone(store.rows[0]['data']['quarterly_results'])
        self.assertEqual(store.rows[0]['last_error'], 'Source data unavailable in selected view: quarterly_results')
        self.assertEqual(reports[-1]['remaining'], 0)
        self.assertEqual(reports[-1]['retry_pending'], 0)
        self.assertEqual(store.control['state'], 'completed_with_failures')
        ingest.Worker(store, fetch, clock.time, clock.sleep, reports.append).run(False)
        self.assertEqual(calls, ['A', 'B'])

    def test_quarter_only_source_empty_annual_is_stored_partial_once(self):
        for annual in (None, []):
            with self.subTest(annual=annual):
                store = MemoryStore([row()]); clock = Clock(); calls = []
                def fetch(symbol, **kw):
                    calls.append(symbol); data = payload(symbol)
                    data['profit_loss']['annual'] = annual
                    data['warnings'] = ['No reporting periods in source table: profit_loss']
                    return data
                ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
                self.assertEqual(calls, ['TCS'])
                self.assertEqual(store.rows[0]['status'], 'partial')
                self.assertEqual(store.rows[0]['attempts'], 1)
                self.assertEqual(store.rows[0]['data']['quarterly_results'], payload()['quarterly_results'])
                self.assertEqual(store.rows[0]['data']['profit_loss']['annual'], annual)
                self.assertEqual(store.rows[0]['last_error'], 'Source data unavailable in selected view: profit_loss.annual')

    def test_quarter_only_annual_without_source_evidence_still_retries(self):
        store = MemoryStore([row()]); clock = Clock(); calls = []
        def fetch(symbol, **kw):
            calls.append(symbol); data = payload(symbol); data['profit_loss']['annual'] = None; return data
        ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(calls, ['TCS', 'TCS'])
        self.assertEqual(store.rows[0]['status'], 'partial')
        self.assertEqual(store.rows[0]['attempts'], 2)
        self.assertEqual(store.rows[0]['data']['quarterly_results'], payload()['quarterly_results'])
        self.assertEqual(store.rows[0]['last_error'], 'Missing financial tables: profit_loss.annual')

    def test_source_empty_with_other_problem_still_retries(self):
        for warnings in (['No reporting periods in source table: quarterly_results', 'Malformed growth table row'],
                         ['No reporting periods in source table: balance_sheet']):
            with self.subTest(warnings=warnings):
                store = MemoryStore([row()]); clock = Clock(); calls = []
                def fetch(symbol, **kw):
                    calls.append(symbol); data = payload(symbol); data['quarterly_results'] = None; data['warnings'] = warnings; return data
                ingest.Worker(store, fetch, clock.time, clock.sleep, lambda x: None).run(False)
                self.assertEqual(calls, ['TCS', 'TCS'])
                self.assertEqual(store.rows[0]['attempts'], 2)
                self.assertFalse(store.rows[0]['last_error'].startswith('Source data unavailable in selected view: '))

    def test_explicit_refresh_resets_source_empty_eligibility(self):
        from contextlib import nullcontext
        store = MemoryStore([row(status='partial', attempts=1, data=payload(),
                                 last_error='Source data unavailable in selected view: quarterly_results')])
        self.assertEqual(store.candidates(False), [])
        class RefreshDB:
            def transaction(self): return nullcontext()
            def execute(self, query):
                if query.startswith('update boardroom_screener_data'):
                    for item in store.rows: item.update(status='pending', attempts=0, last_error=None)
        store.db = RefreshDB()
        ingest.PostgresStore.refresh(store)
        self.assertEqual([r['symbol'] for r in store.candidates(False)], ['TCS'])
        self.assertEqual(store.rows[0]['attempts'], 0)
        self.assertEqual(store.rows[0]['data'], payload())
        self.assertFalse(store.control['pilot_verified'])

    def test_main_reuses_and_closes_company_session_on_success_and_error(self):
        import boardroom_screener_scraper as core
        for fail in (False, True):
            with self.subTest(fail=fail):
                store = MemoryStore([]); store.close = lambda: None
                class Session:
                    def __init__(self): self.headers = {}; self.closed = False
                    def __enter__(self): return self
                    def __exit__(self, *args): self.closed = True
                session = Session(); calls = []
                def scrape(actual_session, symbol, view='auto', pause=0):
                    calls.append((actual_session, symbol, {'pause': pause})); return payload(symbol)
                class TestWorker:
                    def __init__(self, actual_store, fetch): self.fetch = fetch
                    def run(self, pilot):
                        self.fetch('A', pause=0); self.fetch('B', pause=0)
                        if fail: raise RuntimeError('worker failed')
                with patch.dict(ingest.os.environ, {'SUPABASE_DB_URL': 'offline'}), patch.object(ingest, 'PostgresStore', return_value=store), patch.object(ingest, 'Worker', TestWorker), patch.object(core.requests, 'Session', return_value=session) as make_session, patch.object(core, 'scrape', side_effect=scrape):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'worker failed'): ingest.main(['run'])
                    else: ingest.main(['run'])
                make_session.assert_called_once_with()
                self.assertEqual(calls, [(session, 'A', {'pause': 0}), (session, 'B', {'pause': 0})])
                self.assertEqual(session.headers['User-Agent'], core.UA)
                self.assertTrue(session.closed)

    def test_progress_counts_unique_remaining_companies(self):
        store = MemoryStore([row(str(i)) for i in range(2563)])
        reports = []; clock = Clock()
        ingest.Worker(store, None, clock.time, clock.sleep, reports.append).report()
        self.assertEqual(reports[-1]['remaining'], 2563)
        self.assertEqual(reports[-1]['processed'], 0)
        self.assertEqual(reports[-1]['retry_pending'], 0)
    def test_progress_separates_retry_pending(self):
        store = MemoryStore([row('A', status='partial', attempts=1), row('B', status='failed', attempts=2), row('C')])
        reports = []; clock = Clock()
        ingest.Worker(store, None, clock.time, clock.sleep, reports.append).report()
        self.assertEqual(reports[-1]['remaining'], 2)
        self.assertEqual(reports[-1]['processed'], 2)
        self.assertEqual(reports[-1]['retry_pending'], 1)

    def test_eta_uses_fetch_duration_excluding_idle_review(self):
        store = MemoryStore([row('A', status='complete', attempts=1), row('B')])
        store.control['started_at'] = 1
        store.average_company_seconds = lambda: 2.3
        reports = []; clock = Clock()
        ingest.Worker(store, None, clock.time, clock.sleep, reports.append).report()
        self.assertEqual(reports[-1]['eta_seconds'], 2)
        self.assertEqual(reports[-1]['measured_seconds_per_company'], 2.3)
        self.assertEqual(reports[-1]['elapsed_seconds'], 999)

    def test_full_requires_verified_pilot(self):
        store = MemoryStore([row()]); store.control['pilot_verified'] = False
        with self.assertRaises(ValueError): ingest.Worker(store, lambda *a: None).run(False)
    def test_restart_consumes_started_attempt_once(self):
        store = MemoryStore([row(status='fetching', attempts=1)])
        clock = Clock(); ingest.Worker(store, lambda s, **kw: payload(s), clock.time, clock.sleep, lambda x: None).run(False)
        self.assertEqual(store.rows[0]['attempts'], 2)

if __name__ == '__main__': unittest.main()
