-- Provision explicitly; never erase an existing ingestion snapshot.
create table if not exists public.boardroom_screener_data (
 symbol text primary key, company_name text, screener_identifier text not null,
 isin text not null, data jsonb check(data is null or jsonb_typeof(data)='object'), status text not null default 'pending'
 check(status in ('pending','fetching','complete','partial','failed')),
 attempts integer not null default 0 check(attempts between 0 and 2),
 last_error text, fetched_at timestamptz, last_attempt_at timestamptz,
 updated_at timestamptz not null default now(), pilot boolean not null default false
);
create table if not exists public.boardroom_screener_ingestion (
 id integer primary key check(id=1), state text not null default 'pilot_ready'
 check(state in ('pilot_ready','pilot_running','pilot_failed','ready','running','paused','completed','completed_with_failures')),
 started_at double precision, pause_until double precision, batch_number integer not null default 1,
 processed_in_batch integer not null default 0, last_company_start double precision,
 pilot_verified boolean not null default false, total integer, error text,
 updated_at timestamptz not null default now()
);
insert into public.boardroom_screener_ingestion(id) values(1) on conflict(id) do nothing;
alter table public.boardroom_screener_data enable row level security;
alter table public.boardroom_screener_ingestion enable row level security;
revoke all on public.boardroom_screener_data, public.boardroom_screener_ingestion from anon, authenticated;
grant all on public.boardroom_screener_data, public.boardroom_screener_ingestion to service_role;
