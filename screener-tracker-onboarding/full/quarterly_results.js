import { calendarDate, comparisonPeriods, growthPercent } from './scripts/lib/quarter-periods.mjs';

const SORT_COLUMNS = {
  reported_at: 'reported_at',
  revenue_yoy: 'revenue_yoy',
  profit_yoy: 'profit_yoy',
};

const EBITDA_FORMULAS = {
  indas: 'Revenue from operations − materials − stock purchases − inventory changes − employee benefits − other expenses',
  banking: 'Interest earned − employee costs − other operating expenses − provisions other than tax and contingencies',
};

const MARKET_CAP_BUCKETS = {
  under_50: [0, 500_000_000],
  '50_500': [500_000_000, 5_000_000_000],
  '500_5000': [5_000_000_000, 50_000_000_000],
  '5000_plus': [50_000_000_000, null],
};

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function exactQuarter(value) {
  try {
    return comparisonPeriods(String(value)).current;
  } catch {
    throw inputError('Invalid quarter');
  }
}

function quarterLabel(periodEnd) {
  const [year, month] = periodEnd.split('-');
  const names = { '03': 'March', '06': 'June', '09': 'September', '12': 'December' };
  return `${names[month]} ${year}`;
}

function reportedDateLabel(value) {
  const [year, month, day] = calendarDate(value).split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${names[Number(month) - 1]} ${year}`;
}

function positiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw inputError(`Invalid ${name}`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw inputError(`Invalid ${name}`);
  return parsed;
}

function exactDate(value, name) {
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw inputError(`Invalid ${name}`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
    throw inputError(`Invalid ${name}`);
  }
  return text;
}

function nonnegativeNumber(value, name) {
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw inputError(`Invalid ${name}`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) throw inputError(`Invalid ${name}`);
  return parsed;
}

function canonicalDate(value) {
  return calendarDate(value);
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

function querySql(sortColumn, order, { watchlistJoin, predicates, limitPlaceholder, offsetPlaceholder }) {
  return `
    WITH ranked_current AS (
      SELECT current_row.*,
             row_number() OVER (
               PARTITION BY symbol
               ORDER BY CASE WHEN basis = 'consolidated' THEN 0 ELSE 1 END,
                        reported_at DESC,
                        nse_seq_id DESC
             ) AS choice_rank
      FROM quarterly_results AS current_row
      WHERE current_row.status = 'processed'
        AND current_row.superseded_by_seq_id IS NULL
        AND current_row.period_end = $1
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
      ${watchlistJoin}
      LEFT JOIN LATERAL (
        SELECT * FROM quarterly_results AS previous
        WHERE previous.symbol = current.symbol
          AND previous.basis = current.basis
          AND previous.period_end = $2
          AND previous.status = 'processed'
          AND previous.superseded_by_seq_id IS NULL
        ORDER BY previous.reported_at DESC, previous.nse_seq_id DESC
        LIMIT 1
      ) AS previous ON true
      LEFT JOIN LATERAL (
        SELECT * FROM quarterly_results AS prior_year
        WHERE prior_year.symbol = current.symbol
          AND prior_year.basis = current.basis
          AND prior_year.period_end = $3
          AND prior_year.status = 'processed'
          AND prior_year.superseded_by_seq_id IS NULL
        ORDER BY prior_year.reported_at DESC, prior_year.nse_seq_id DESC
        LIMIT 1
      ) AS prior_year ON true
      WHERE ${predicates.join('\n        AND ')}
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
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
  `;
}

function countSql({ watchlistJoin, predicates }) {
  return `
    WITH ranked_current AS (
      SELECT current_row.*,
             row_number() OVER (
               PARTITION BY symbol
               ORDER BY CASE WHEN basis = 'consolidated' THEN 0 ELSE 1 END,
                        reported_at DESC,
                        nse_seq_id DESC
             ) AS choice_rank
      FROM quarterly_results AS current_row
      WHERE current_row.status = 'processed'
        AND current_row.superseded_by_seq_id IS NULL
        AND current_row.period_end = $1
    ),
    current_choice AS (
      SELECT * FROM ranked_current WHERE choice_rank = 1
    )
    SELECT count(*)::int AS total
    FROM current_choice AS current
    JOIN market_universe AS universe ON universe.symbol = current.symbol
    ${watchlistJoin}
    WHERE ${predicates.join('\n      AND ')}
  `;
}

export function createQuarterlyResultsService({ dbPool }) {
  if (!dbPool?.query) throw new Error('dbPool is required');

  return {
    async list(params = {}, _context = {}) {
      const hasParam = (name) => Object.prototype.hasOwnProperty.call(params, name);
      const q = String(params.q ?? '').trim();
      if (q.length > 100) throw inputError('Invalid search');
      const sort = String(params.sort ?? 'reported_at');
      const sortColumn = SORT_COLUMNS[sort];
      if (!sortColumn) throw inputError('Invalid sort');
      const order = String(params.order ?? 'desc').toLowerCase();
      if (!['asc', 'desc'].includes(order)) throw inputError('Invalid order');
      const page = positiveInteger(params.page, 'page', 1);
      const limit = positiveInteger(params.limit, 'limit', 25, 50);
      const reportedDate = hasParam('reported_date')
        ? exactDate(params.reported_date, 'reported_date')
        : null;
      if (hasParam('watchlist') && params.watchlist !== 'true') throw inputError('Invalid watchlist');
      const watchlist = hasParam('watchlist');
      if (watchlist && !_context.userId) throw new Error('Authenticated user is required');
      const marketCapBucket = hasParam('market_cap_bucket') ? String(params.market_cap_bucket) : null;
      if (marketCapBucket != null && !MARKET_CAP_BUCKETS[marketCapBucket]) throw inputError('Invalid market_cap_bucket');
      const marketCapMin = hasParam('market_cap_min')
        ? nonnegativeNumber(params.market_cap_min, 'market_cap_min')
        : null;
      const marketCapMax = hasParam('market_cap_max')
        ? nonnegativeNumber(params.market_cap_max, 'market_cap_max')
        : null;
      if (marketCapBucket && (marketCapMin != null || marketCapMax != null)) {
        throw inputError('Market cap bucket and custom bounds are mutually exclusive');
      }
      if (marketCapMin != null && marketCapMax != null && marketCapMin > marketCapMax) {
        throw inputError('Invalid market cap range');
      }
      let activeQuarter;
      if (!hasParam('quarter')) {
        const activeResult = await dbPool.query(`
          SELECT max(period_end)::text AS period_end
          FROM quarterly_results
          WHERE status = 'processed' AND superseded_by_seq_id IS NULL
        `);
        if (!activeResult.rows[0]?.period_end) throw new Error('No processed quarterly results available');
        activeQuarter = exactQuarter(calendarDate(activeResult.rows[0].period_end));
      } else {
        activeQuarter = exactQuarter(params.quarter);
      }
      const periods = comparisonPeriods(activeQuarter);
      const queryParams = [periods.current, periods.previous, periods.priorYear, q, `%${q}%`];
      const bind = (value) => {
        queryParams.push(value);
        return `$${queryParams.length}`;
      };
      const predicates = ["($4 = '' OR universe.symbol ILIKE $5 OR universe.company_name ILIKE $5)"];
      if (reportedDate) {
        predicates.push(`(current.reported_at AT TIME ZONE 'Asia/Kolkata')::date = ${bind(reportedDate)}::date`);
      }
      const watchlistJoin = watchlist
        ? `JOIN watchlists AS watchlist
           ON watchlist.symbol = current.symbol
          AND watchlist.user_id = ${bind(_context.userId)}`
        : '';
      let marketCapBounds = marketCapBucket ? MARKET_CAP_BUCKETS[marketCapBucket] : null;
      if (!marketCapBounds && (marketCapMin != null || marketCapMax != null)) {
        marketCapBounds = [
          marketCapMin == null ? null : marketCapMin * 10_000_000,
          marketCapMax == null ? null : marketCapMax * 10_000_000,
        ];
      }
      if (marketCapBounds) {
        if (marketCapBounds[0] != null) predicates.push(`universe.market_cap >= ${bind(marketCapBounds[0])}`);
        if (marketCapBounds[1] != null) {
          const operator = marketCapBucket ? '<' : '<=';
          predicates.push(`universe.market_cap ${operator} ${bind(marketCapBounds[1])}`);
        }
      }
      const compactCountPlaceholders = (sql) => sql.replace(/\$(\d+)/g, (_match, rawIndex) => {
        const index = Number(rawIndex);
        return `$${index === 1 ? 1 : index - 2}`;
      });
      const countParams = [periods.current, ...queryParams.slice(3)];
      const countWatchlistJoin = compactCountPlaceholders(watchlistJoin);
      const countPredicates = predicates.map(compactCountPlaceholders);
      const limitPlaceholder = bind(limit);
      const offsetPlaceholder = bind((page - 1) * limit);
      const [result, countResult, quartersResult, datesResult, watchlistResult] = await Promise.all([
        dbPool.query(
          querySql(sortColumn, order.toUpperCase(), {
            watchlistJoin, predicates, limitPlaceholder, offsetPlaceholder,
          }),
          queryParams,
        ),
        dbPool.query(countSql({
          watchlistJoin: countWatchlistJoin,
          predicates: countPredicates,
        }), countParams),
        dbPool.query(`
          SELECT period_end::text AS period_end, count(DISTINCT symbol)::int AS companies
          FROM quarterly_results
          WHERE status = 'processed' AND superseded_by_seq_id IS NULL
          GROUP BY period_end
          ORDER BY period_end DESC
        `),
        dbPool.query(`
          WITH ranked_current AS (
            SELECT current_row.*,
                   row_number() OVER (
                     PARTITION BY symbol
                     ORDER BY CASE WHEN basis = 'consolidated' THEN 0 ELSE 1 END,
                              reported_at DESC,
                              nse_seq_id DESC
                   ) AS choice_rank
            FROM quarterly_results AS current_row
            WHERE current_row.status = 'processed'
              AND current_row.superseded_by_seq_id IS NULL
              AND current_row.period_end = $1
          ),
          current_choice AS (
            SELECT * FROM ranked_current WHERE choice_rank = 1
          )
          SELECT (reported_at AT TIME ZONE 'Asia/Kolkata')::date::text AS date,
                 count(*)::int AS companies
          FROM current_choice
          GROUP BY (reported_at AT TIME ZONE 'Asia/Kolkata')::date
          ORDER BY date DESC
        `, [activeQuarter]),
        dbPool.query(`
          SELECT count(DISTINCT symbol)::int AS companies
          FROM watchlists
          WHERE user_id = $1
        `, [_context.userId]),
      ]);
      const total = Number(countResult.rows[0]?.total ?? result.rows[0]?.total_count ?? 0);
      return {
        meta: {
          activeQuarter,
          activeQuarterLabel: quarterLabel(activeQuarter),
          quarters: quartersResult.rows.map((row) => {
            const periodEnd = calendarDate(row.period_end);
            return { periodEnd, label: quarterLabel(periodEnd), companies: Number(row.companies) };
          }),
          reportedDates: datesResult.rows.map((row) => {
            const date = calendarDate(row.date);
            return { date, label: reportedDateLabel(date), companies: Number(row.companies) };
          }),
          watchlistCompanies: Number(watchlistResult.rows[0]?.companies ?? 0),
        },
        items: result.rows.map(responseItem),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
  };
}
