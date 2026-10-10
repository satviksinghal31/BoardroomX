#!/usr/bin/env python3
"""Durable sequential ingestion. Provision ingestion.sql before using this CLI."""
from __future__ import annotations
import argparse
import json
import os
import re
import time
from pathlib import Path

PILOT = ['RELIANCE', 'HDFCBANK', 'CARBORUNIV', 'SHILPAMED', 'MPHASIS', 'ATHERENERG', 'HESTERBIO', 'NAVKARURB', 'SBIN', 'TCS']
LOCK_ID = 728410331


def blocked(error):
    text = str(error)
    status = getattr(error, 'status', None)
    return status in (401, 403, 429) or (status is not None and status >= 500) or bool(re.search(r'HTTP (?:401|403|429|5\d\d)|Network error|Retry-After|Unexpected company-page response', text, re.I))


def assess(data, symbol):
    from boardroom_screener_scraper import validate_company
    validate_company(data)
    if (data.get('profile') or {}).get('nse_code') != symbol: raise ValueError(f'Identity mismatch: expected {symbol}')
    annual = data['profit_loss'].get('annual')
    warnings = data.get('warnings', [])
    if not isinstance(warnings, list) or any(not isinstance(w, str) for w in warnings): raise ValueError('Malformed warnings')
    significant = [w for w in warnings if not w.startswith('Fewer than five annual periods') and not w.startswith('Login required')]
    missing = [k for k in ('quarterly_results', 'balance_sheet', 'cash_flow', 'ratios') if not data.get(k)]
    if not isinstance(annual, list) or not annual or any(not isinstance(r, dict) for r in annual): significant.append('Missing or malformed annual financial table')
    if missing: significant.append('Missing financial tables: ' + ', '.join(missing))
    return ('partial', '; '.join(significant)) if significant else ('complete', None)


def quality(data):
    if not data: return -1
    return sum(1 for value in data.values() if value is not None) + sum(len(data.get(k) or []) for k in ('quarterly_results', 'balance_sheet', 'cash_flow', 'ratios')) + len((data.get('profit_loss') or {}).get('annual') or []) - len(data.get('warnings') or [])


class Worker:
    def __init__(self, store, fetch, clock=time.time, sleep=time.sleep, emit=None):
        self.store, self.fetch, self.clock, self.sleep = store, fetch, clock, sleep
        self.emit = emit or (lambda value: print(json.dumps(value), flush=True))
    def report(self, symbol=None):
        c = self.store.control; counts = self.store.counts()
        remaining = self.store.remaining_companies() if hasattr(self.store, 'remaining_companies') else len(self.store.candidates(False))
        retry_pending = self.store.retry_pending() if hasattr(self.store, 'retry_pending') else sum(r['status'] in ('partial', 'failed') for r in self.store.candidates(False))
        elapsed = max(0, self.clock() - (c.get('started_at') or self.clock()))
        done = counts['complete'] + counts['partial'] + counts['failed']
        average = max(2, self.store.average_company_seconds() if hasattr(self.store, 'average_company_seconds') else elapsed / max(1, done))
        self.emit(dict(counts, symbol=symbol, state=c['state'], elapsed_seconds=round(elapsed), batch_number=c['batch_number'], processed_in_batch=c['processed_in_batch'], remaining=remaining, processed=done, retry_pending=retry_pending, measured_seconds_per_company=round(average, 3), eta_basis='Unique remaining companies times measured fetch duration (minimum 2 seconds); idle time excluded and additional retries not guaranteed', eta_seconds=round(remaining * average), cooldown_seconds=0, error=c.get('error')))
    def run(self, pilot):
        from boardroom_screener_scraper import to_standard_json
        s = self.store
        if not pilot and not s.control['pilot_verified']: raise ValueError('Pilot must be complete and verified before full run')
        if s.control['state'] == 'paused' and s.control.get('error'): raise ValueError('Paused after upstream error; inspect and explicitly resume before retry')
        if s.control.get('pause_until') is not None and self.clock() < s.control['pause_until']: raise ValueError('Retry-After deadline has not elapsed')
        s.recover()
        s.update_control(state='pilot_running' if pilot else 'running', started_at=s.control.get('started_at') or self.clock(), error=None)
        try:
            while True:
                candidates = s.candidates(pilot)
                if not candidates: break
                r = candidates[0]
                last = s.control.get('last_company_start')
                if last is not None: self.sleep(max(0, last + 2 - self.clock()))
                if hasattr(s, 'check_lock'): s.check_lock()
                s.begin(r, self.clock())
                data = None; status = 'failed'; error = None; stop = False; retry_after = None
                try:
                    fresh = self.fetch(r['screener_identifier'], pause=0)
                    if isinstance(fresh, dict):
                        stop = any(blocked(w) for w in fresh.get('warnings', []) if isinstance(w, str)) if isinstance(fresh.get('warnings', []), list) else False
                    fresh = to_standard_json(fresh)
                    status, error = assess(fresh, r['symbol'])
                    data = fresh
                    stop = any(blocked(w) for w in fresh.get('warnings', []))
                    if r.get('data') and status != 'complete':
                        previous = to_standard_json(r['data'])
                        if quality(previous) > quality(fresh): data = previous
                except Exception as exc:
                    error = str(exc); stop = stop or blocked(exc); retry_after = getattr(exc, 'retry_after', None)
                    if r.get('data'): status = 'partial'; data = r['data']
                if data is not None: data = to_standard_json(data)
                returned = s.finish(r, status, data, error, self.clock())
                if data is not None and returned != data: raise RuntimeError('Stored JSON failed exact roundtrip verification')
                if stop:
                    s.update_control(state='paused', error=error or '; '.join(data.get('warnings', [])), pause_until=self.clock()+retry_after if retry_after is not None else None)
                    self.report(r['symbol']); return
                if s.control['processed_in_batch'] >= 50:
                    self.report(r['symbol'])
                    s.update_control(batch_number=s.control['batch_number'] + 1, processed_in_batch=0)
                self.report(r['symbol'])
            if pilot:
                complete = all(r['status'] == 'complete' for r in s.pilot_rows()) if hasattr(s, 'pilot_rows') else True
                s.update_control(state='pilot_ready' if complete else 'pilot_failed')
            else:
                counts = s.counts(); s.update_control(state='completed' if counts['complete'] == counts['total'] else 'completed_with_failures')
            self.report()
        except KeyboardInterrupt:
            s.recover(); s.update_control(state='paused', error=None); self.report()
        except Exception as exc:
            try: s.update_control(state='paused', error=str(exc))
            except Exception: pass
            raise


class PostgresStore:
    def __init__(self, url, acquire_lock=True):
        import psycopg
        from psycopg.rows import dict_row
        self.db = psycopg.connect(url, row_factory=dict_row)
        self.lock = psycopg.connect(url, autocommit=True)
        if acquire_lock and not self.lock.execute('select pg_try_advisory_lock(%s)', (LOCK_ID,)).fetchone()[0]:
            self.close(); raise RuntimeError('Another ingestion worker owns the lock')
        self.control = self.db.execute('select * from boardroom_screener_ingestion where id=1').fetchone()
        if not self.control: raise RuntimeError('Run ingestion.sql first')
        self.db.commit()
    def check_lock(self):
        self.lock.execute('select 1').fetchone()
    def close(self):
        if getattr(self, 'db', None): self.db.close()
        if getattr(self, 'lock', None): self.lock.close()
    def update_control(self, **values):
        with self.db.transaction():
            self.db.execute('update boardroom_screener_ingestion set ' + ','.join(k+'=%s' for k in values) + ',updated_at=now() where id=1', tuple(values.values()))
        self.control.update(values)
    def recover(self):
        with self.db.transaction(): self.db.execute("update boardroom_screener_data set status=case when data is null then 'failed' else 'partial' end,last_error='Interrupted attempt; attempt already consumed',updated_at=now() where status='fetching'")
    def candidates(self, pilot):
        rows = self.db.execute("select * from boardroom_screener_data where pilot=%s and status<>'complete' and attempts<2 order by attempts,case symbol " + ' '.join("when '"+v+"' then "+str(i) for i,v in enumerate(PILOT)) + ' else 100 end,symbol limit 1', (pilot,)).fetchall(); self.db.commit(); return rows
    def pilot_rows(self):
        rows = self.db.execute('select * from boardroom_screener_data where pilot').fetchall(); self.db.commit(); return rows
    def begin(self, row, now):
        with self.db.transaction():
            self.db.execute("update boardroom_screener_data set status='fetching',attempts=attempts+1,last_attempt_at=to_timestamp(%s),updated_at=now() where symbol=%s and attempts<2", (now,row['symbol']))
            self.db.execute('update boardroom_screener_ingestion set last_company_start=%s,processed_in_batch=processed_in_batch+1,updated_at=now() where id=1', (now,))
        row['attempts'] += 1
        self.control.update(last_company_start=now, processed_in_batch=self.control['processed_in_batch']+1)
    def finish(self, row, status, data, error, now):
        from boardroom_screener_scraper import to_standard_json
        from psycopg.types.json import Jsonb
        if data is not None: data = to_standard_json(data)
        with self.db.transaction():
            result = self.db.execute('update boardroom_screener_data set status=%s,data=coalesce(%s,data),last_error=%s,fetched_at=case when %s then %s::timestamptz else fetched_at end,updated_at=now() where symbol=%s returning data', (status,Jsonb(data) if data is not None else None,error,data is not None,data.get('scraped_at') if data else None,row['symbol'])).fetchone()['data']
            if data is not None and result != data: raise RuntimeError('Stored JSON failed exact roundtrip verification')
        return result
    def counts(self):
        rows = self.db.execute('select status,count(*) as n from boardroom_screener_data group by status').fetchall(); self.db.commit()
        result = dict.fromkeys(('pending','fetching','complete','partial','failed'),0)
        result.update({r['status']:r['n'] for r in rows}); result['total']=sum(result.values()); return result
    def remaining_companies(self):
        value = self.db.execute("select count(*) as n from boardroom_screener_data where status<>'complete' and attempts<2").fetchone()['n']
        self.db.commit(); return value
    def retry_pending(self):
        value = self.db.execute("select count(*) as n from boardroom_screener_data where status in ('partial','failed') and attempts<2").fetchone()['n']
        self.db.commit(); return value
    def average_company_seconds(self):
        value = self.db.execute("select coalesce(avg(greatest(2,extract(epoch from (updated_at-last_attempt_at)))),2) as n from boardroom_screener_data where status in ('complete','partial','failed') and attempts>0 and last_attempt_at is not null").fetchone()['n']
        self.db.commit(); return float(value)
    def seed(self):
        with self.db.transaction():
            if self.db.execute('select count(*) as n from boardroom_screener_data').fetchone()['n']: raise ValueError('Universe already frozen; seed is one-time')
            rows = self.db.execute("select upper(trim(d.symbol)) symbol,max(d.company_name) company_name,max(d.isin) isin,count(distinct d.isin) isin_count from dhan_instruments d join equity_universe_taxonomy t on t.ticker=d.symbol and t.instrument_type='EQUITY_SHARE' where d.is_active=true and d.instrument='EQUITY' and d.dhan_exchange_segment='NSE_EQ' group by upper(trim(d.symbol))").fetchall()
            if not rows or any(r['isin_count'] != 1 for r in rows): raise ValueError('Empty or ambiguous source universe')
            if not set(PILOT).issubset({r['symbol'] for r in rows}): raise ValueError('Pilot members missing from universe')
            self.db.execute('update boardroom_screener_ingestion set total=%s,updated_at=now() where id=1',(len(rows),))
            with self.db.cursor() as cursor:
                cursor.executemany('insert into boardroom_screener_data(symbol,company_name,isin,screener_identifier,pilot) values(%s,%s,%s,%s,%s)', [(r['symbol'],r['company_name'],r['isin'],'531494' if r['symbol']=='NAVKARURB' else r['symbol'],r['symbol'] in PILOT) for r in rows])
    def verify_pilot(self):
        rows = self.pilot_rows()
        if len(rows)!=10 or any(r['status']!='complete' or assess(r['data'],r['symbol'])[0]!='complete' for r in rows): raise ValueError('All ten pilot JSON records must validate as complete')
        self.update_control(pilot_verified=True,state='ready',error=None)
    def refresh(self):
        deadline = self.control.get('pause_until')
        if deadline is not None and time.time() < deadline: raise ValueError('Retry-After deadline has not elapsed')
        with self.db.transaction():
            self.db.execute("update boardroom_screener_data set status='pending',attempts=0,last_error=null,updated_at=now()")
            self.db.execute("update boardroom_screener_ingestion set state='pilot_ready',pilot_verified=false,started_at=null,processed_in_batch=0,batch_number=1,error=null,pause_until=null,updated_at=now() where id=1")
        self.control.update(state='pilot_ready',pilot_verified=False,started_at=None,processed_in_batch=0,batch_number=1,error=None,pause_until=None)


def resume(store, now):
    deadline = store.control.get('pause_until')
    if deadline is not None and now < deadline: raise ValueError(f'Retry-After requires waiting {deadline-now:.0f} more seconds')
    store.update_control(state='ready' if store.control['pilot_verified'] else 'pilot_ready',error=None,pause_until=None)


def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command',choices=['seed','pilot','verify-pilot','run','progress','resume'])
    ap.add_argument('--refresh',action='store_true',help='Explicit weekly refresh; retains last good JSON and requires a new pilot')
    args=ap.parse_args(argv)
    url=os.environ.get('SUPABASE_DB_URL')
    if not url: ap.error('SUPABASE_DB_URL must be set in the environment')
    store=PostgresStore(url, acquire_lock=args.command != 'progress')
    try:
        if args.refresh:
            if args.command!='pilot': raise ValueError('--refresh requires pilot command')
            store.refresh()
        if args.command=='seed': store.seed()
        elif args.command=='verify-pilot': store.verify_pilot()
        elif args.command=='resume': resume(store, time.time())
        elif args.command in ('pilot','run'):
            from boardroom_screener_scraper import fetch_company
            Worker(store,fetch_company).run(args.command=='pilot')
        else: Worker(store,None).report()
    finally: store.close()

if __name__=='__main__': main()
