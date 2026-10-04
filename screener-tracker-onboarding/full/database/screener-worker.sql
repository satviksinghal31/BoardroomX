-- One manual batch, one sequential worker, one retry pass.
create table public.screener_runs (
 id uuid primary key default gen_random_uuid(),
 status text not null default 'running' check(status in ('running','completed','completed_with_failures','not_completed')),
 pass text not null default 'first' check(pass in ('first','retry')),
 total integer not null check(total>0),
 started_at timestamptz not null default now(), finished_at timestamptz,
 error text
);
create unique index screener_one_running on public.screener_runs(status) where status='running';
create table public.screener_run_items (
 run_id uuid not null references public.screener_runs(id),
 symbol text not null, company_name text,
 status text not null default 'pending' check(status in ('pending','fetching','awaiting_retry','successful','failed')),
 attempts integer not null default 0 check(attempts between 0 and 2),
 error text, updated_at timestamptz not null default now(),
 primary key(run_id,symbol)
);
create index screener_items_status on public.screener_run_items(run_id,status);
create table public.screener_company_data (
 symbol text primary key,
 data jsonb not null check(jsonb_typeof(data)='object'),
 updated_at timestamptz not null default now(),
 run_id uuid not null references public.screener_runs(id),
 source_url text not null, basis text not null check(basis in ('consolidated','standalone'))
);
alter table public.screener_runs enable row level security;
alter table public.screener_run_items enable row level security;
alter table public.screener_company_data enable row level security;
revoke all on public.screener_runs,public.screener_run_items,public.screener_company_data from anon,authenticated;
grant all on public.screener_runs,public.screener_run_items,public.screener_company_data to service_role;
