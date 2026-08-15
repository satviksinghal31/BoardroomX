import { growthPercent } from './scripts/lib/quarter-periods.mjs';

const SORT_COLUMNS = {
  reported_at: 'reported_at',
  revenue_yoy: 'revenue_yoy',
  profit_yoy: 'profit_yoy',
};

const EBITDA_FORMULAS = {
  indas: 'Revenue from operations − materials − stock purchases − inventory changes − employee benefits − other expenses',
  banking: 'Interest earned − employee costs − other operating expenses − provisions other than tax and contingencies',
};

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function positiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw inputError(`Invalid ${name}`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw inputError(`Invalid ${name}`);
  return parsed;
}

function canonicalDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function canonicalTimestamp(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function roundRatio(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

function inrToCrore(value) {
  if (value == null) return null;
  const integer = BigInt(String(value));
  return Number(roundRatio(integer, 1_000_000n)) / 10;
}

function metric(current, previous, priorYear) {
  return {
    current: inrToCrore(current),
    previous: inrToCrore(previous),
    priorYear: inrToCrore(priorYear),
  };
}

function responseItem(row) {
  return {
    symbol: row.symbol,
    companyName: row.company_name,
    basis: row.basis,
    taxonomy: row.taxonomy,
    reportedAt: canonicalTimestamp(row.reported_at),
    periods: {
      current: canonicalDate(row.current_period),
      previous: canonicalDate(row.previous_period),
      priorYear: canonicalDate(row.prior_year_period),
    },
    metrics: {
      revenue: metric(row.current_revenue, row.previous_revenue, row.prior_year_revenue),
      calculatedEbitda: metric(row.current_ebitda, row.previous_ebitda, row.prior_year_ebitda),
      netProfit: metric(row.current_profit, row.previous_profit, row.prior_year_profit),
    },
    growth: {
      revenueQoq: growthPercent(row.current_revenue, row.previous_revenue),
      revenueYoy: growthPercent(row.current_revenue, row.prior_year_revenue),
      ebitdaQoq: growthPercent(row.current_ebitda, row.previous_ebitda),
      ebitdaYoy: growthPercent(row.current_ebitda, row.prior_year_ebitda),
      profitQoq: growthPercent(row.current_profit, row.previous_profit),
      profitYoy: growthPercent(row.current_profit, row.prior_year_profit),
    },
    sources: {
      current: row.current_source,
      previous: row.previous_source,
      priorYear: row.prior_year_source,
    },
    ebitdaFormula: EBITDA_FORMULAS[row.taxonomy],
  };
}

function querySql(sortColumn, order) {
  return `
    WITH eligible AS (
      SELECT *
      FROM quarterly_results
      WHERE status = 'processed' AND superseded_by_seq_id IS NULL
    ),
    ranked_current AS (
      SELECT eligible.*,
             row_number() OVER (
               PARTITION BY symbol
               ORDER BY period_end DESC,
                        CASE WHEN basis = 'consolidated' THEN 0 ELSE 1 END,
                        reported_at DESC,
                        nse_seq_id DESC
             ) AS choice_rank
      FROM eligible
    ),
    current_choice AS (
      SELECT * FROM ranked_current WHERE choice_rank = 1
    ),
    assembled AS (
      SELECT
        current.symbol,
        universe.company_name,
        current.basis,
        current.taxonomy,
        current.reported_at,
        current.period_end AS current_period,
        previous.period_end AS previous_period,
        prior_year.period_end AS prior_year_period,
        current.revenue_inr AS current_revenue,
        previous.revenue_inr AS previous_revenue,
        prior_year.revenue_inr AS prior_year_revenue,
        current.calculated_ebitda_inr AS current_ebitda,
        previous.calculated_ebitda_inr AS previous_ebitda,
        prior_year.calculated_ebitda_inr AS prior_year_ebitda,
        current.net_profit_inr AS current_profit,
        previous.net_profit_inr AS previous_profit,
        prior_year.net_profit_inr AS prior_year_profit,
        current.source_xbrl_url AS current_source,
        previous.source_xbrl_url AS previous_source,
        prior_year.source_xbrl_url AS prior_year_source
      FROM current_choice AS current
      JOIN market_universe AS universe ON universe.symbol = current.symbol
      LEFT JOIN LATERAL (
        SELECT * FROM eligible AS previous
        WHERE previous.symbol = current.symbol
          AND previous.basis = current.basis
          AND previous.period_end = CASE extract(month FROM current.period_end)
            WHEN 3 THEN make_date(extract(year FROM current.period_end)::int - 1, 12, 31)
            WHEN 6 THEN make_date(extract(year FROM current.period_end)::int, 3, 31)
            WHEN 9 THEN make_date(extract(year FROM current.period_end)::int, 6, 30)
            WHEN 12 THEN make_date(extract(year FROM current.period_end)::int, 9, 30)
          END
        ORDER BY previous.reported_at DESC, previous.nse_seq_id DESC
        LIMIT 1
      ) AS previous ON true
      LEFT JOIN LATERAL (
        SELECT * FROM eligible AS prior_year
        WHERE prior_year.symbol = current.symbol
          AND prior_year.basis = current.basis
          AND prior_year.period_end = (current.period_end - interval '1 year')::date
        ORDER BY prior_year.reported_at DESC, prior_year.nse_seq_id DESC
        LIMIT 1
      ) AS prior_year ON true
      WHERE ($1 = '' OR universe.symbol ILIKE $2 OR universe.company_name ILIKE $2)
    ),
    sortable AS (
      SELECT assembled.*,
        CASE WHEN prior_year_revenue IS NULL OR prior_year_revenue = 0 THEN NULL
          ELSE ((current_revenue - prior_year_revenue) / abs(prior_year_revenue)) * 100 END AS revenue_yoy,
        CASE WHEN prior_year_profit IS NULL OR prior_year_profit = 0 THEN NULL
          ELSE ((current_profit - prior_year_profit) / abs(prior_year_profit)) * 100 END AS profit_yoy
      FROM assembled
    )
    SELECT sortable.*, count(*) OVER () AS total_count
    FROM sortable
    ORDER BY ${sortColumn} ${order} NULLS LAST, reported_at DESC, symbol ASC
    LIMIT $3 OFFSET $4
  `;
}

export function createQuarterlyResultsService({ dbPool }) {
  if (!dbPool?.query) throw new Error('dbPool is required');

  return {
    async list(params = {}) {
      const q = String(params.q ?? '').trim();
      if (q.length > 100) throw inputError('Invalid search');
      const sort = String(params.sort ?? 'reported_at');
      const sortColumn = SORT_COLUMNS[sort];
      if (!sortColumn) throw inputError('Invalid sort');
      const order = String(params.order ?? 'desc').toLowerCase();
      if (!['asc', 'desc'].includes(order)) throw inputError('Invalid order');
      const page = positiveInteger(params.page, 'page', 1);
      const limit = positiveInteger(params.limit, 'limit', 50, 50);
      const result = await dbPool.query(
        querySql(sortColumn, order.toUpperCase()),
        [q, `%${q}%`, limit, (page - 1) * limit],
      );
      const total = Number(result.rows[0]?.total_count ?? 0);
      return {
        items: result.rows.map(responseItem),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
  };
}

