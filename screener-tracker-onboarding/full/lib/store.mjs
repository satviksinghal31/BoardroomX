import pg from "pg";
export class Store {
  constructor(pool) {
    this.pool = pool;
  }
  async transaction(fn) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async start(symbols) {
    try {
      return await this.transaction(async (c) => {
        const params = symbols ? [symbols] : [];
        const { rows: stocks } = await c.query(
          `select distinct upper(trim(symbol)) as symbol,max(company_name) as company_name from public.dhan_instruments where is_active=true and trim(symbol)<>'' ${symbols ? "and upper(trim(symbol))=any($1::text[])" : ""} group by upper(trim(symbol)) order by symbol`,
          params,
        );
        if (!stocks.length || (symbols && stocks.length !== symbols.length)) {
          const e = Error("No matching active companies in DB");
          e.status = 400;
          throw e;
        }
        const {
          rows: [run],
        } = await c.query(
          "insert into public.screener_runs(total) values($1) returning *",
          [stocks.length],
        );
        await c.query(
          `insert into public.screener_run_items(run_id,symbol,company_name) select $1,symbol,company_name from jsonb_to_recordset($2::jsonb) as x(symbol text,company_name text)`,
          [run.id, JSON.stringify(stocks)],
        );
        return run;
      });
    } catch (e) {
      if (e.code === "23505") {
        const conflict = Error("A run is already running");
        conflict.status = 409;
        throw conflict;
      }
      throw e;
    }
  }
  async isRunning(id) {
    return (
      (
        await this.pool.query(
          "select 1 from public.screener_runs where id=$1 and status='running'",
          [id],
        )
      ).rowCount === 1
    );
  }
  async setPass(id, pass) {
    await this.pool.query(
      "update public.screener_runs set pass=$2 where id=$1 and status='running'",
      [id, pass],
    );
  }
  async listItems(id, status) {
    return (
      await this.pool.query(
        "select symbol from public.screener_run_items where run_id=$1 and status=$2 order by symbol",
        [id, status],
      )
    ).rows;
  }
  async fetching(id, symbol) {
    await this.pool.query(
      "update public.screener_run_items set status='fetching',updated_at=now() where run_id=$1 and symbol=$2 and status in ('pending','awaiting_retry')",
      [id, symbol],
    );
  }
  async outcome(id, symbol, data, error, final) {
    return this.transaction(async (c) => {
      const {
        rows: [run],
      } = await c.query(
        "select status from public.screener_runs where id=$1 for update",
        [id],
      );
      if (run?.status !== "running") return;
      const {
        rows: [item],
      } = await c.query(
        "select status,attempts from public.screener_run_items where run_id=$1 and symbol=$2 for update",
        [id, symbol],
      );
      if (item?.status !== "fetching" || item.attempts >= 2)
        throw Error("Invalid company outcome");
      if (data)
        await c.query(
          `insert into public.screener_company_data(symbol,data,run_id,source_url,basis) values($1,$2,$3,$4,$5) on conflict(symbol) do update set data=excluded.data,run_id=excluded.run_id,source_url=excluded.source_url,basis=excluded.basis,updated_at=now()`,
          [
            symbol,
            JSON.stringify(data),
            id,
            data.source.url,
            data.source.basis,
          ],
        );
      await c.query(
        "update public.screener_run_items set status=$3,attempts=attempts+1,error=$4,updated_at=now() where run_id=$1 and symbol=$2",
        [
          id,
          symbol,
          data ? "successful" : final ? "failed" : "awaiting_retry",
          data ? null : error,
        ],
      );
    });
  }
  async finish(id) {
    const result = await this.pool.query(
      `update public.screener_runs r set status=case when exists(select 1 from public.screener_run_items i where i.run_id=r.id and i.status='failed') then 'completed_with_failures' else 'completed' end,finished_at=now() where id=$1 and status='running' and not exists(select 1 from public.screener_run_items i where i.run_id=r.id and i.status not in ('successful','failed')) returning id`,
      [id],
    );
    if (!result.rowCount) throw Error("Cannot finish an unfinished batch");
  }
  async interrupt(id, error = "Worker stopped. Start a new batch manually.") {
    await this.pool.query(
      "update public.screener_runs set status='not_completed',finished_at=now(),error=$2 where id=$1 and status='running'",
      [id, error],
    );
  }
  async startup() {
    await this.pool.query(
      "update public.screener_runs set status='not_completed',finished_at=now(),error='Railway restarted. Start a new batch manually.' where status='running'",
    );
  }
  async current() {
    const {
      rows: [run],
    } = await this.pool.query(
      "select * from public.screener_runs order by started_at desc,id desc limit 1",
    );
    const {
      rows: [universe],
    } = await this.pool.query(
      "select count(distinct upper(trim(symbol)))::int as total from public.dhan_instruments where is_active=true and trim(symbol)<>''",
    );
    if (!run) return { run: null, universe_total: universe.total };
    const {
      rows: [counts],
    } = await this.pool.query(
      `select count(*) filter(where status in ('successful','failed'))::int as processed,count(*) filter(where status='successful')::int as successful,count(*) filter(where status='failed')::int as failed,count(*) filter(where status='awaiting_retry')::int as awaiting_retry,max(symbol) filter(where status='fetching') as current_company from public.screener_run_items where run_id=$1`,
      [run.id],
    );
    const { rows: failures } = await this.pool.query(
      "select symbol,company_name,status,attempts,error from public.screener_run_items where run_id=$1 and status in ('awaiting_retry','failed','fetching') order by symbol",
      [run.id],
    );
    return {
      run: { ...run, ...counts, failures },
      universe_total: universe.total,
    };
  }
  async close() {
    await this.pool.end();
  }
}
export function createStore() {
  if (!process.env.SUPABASE_DB_URL) throw Error("SUPABASE_DB_URL is required");
  return new Store(
    new pg.Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      max: 4,
      connectionTimeoutMillis: 15000,
      statement_timeout: 30000,
    }),
  );
}
