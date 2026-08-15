import { calendarDate, comparisonPeriods } from './lib/quarter-periods.mjs';
import { parseQuarterlyXbrl } from './lib/nse-quarterly-xbrl.mjs';

const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000];

class PermanentFilingError extends Error {}

function taxonomyFromUrl(url) {
  const match = /\/INTEGRATED_FILING_(INDAS|BANKING)_/i.exec(String(url));
  if (!match) throw new PermanentFilingError(`Unsupported XBRL identity in URL: ${url}`);
  return match[1].toLowerCase();
}

function pendingRow(filing) {
  if (!filing.publishedAt) {
    throw new PermanentFilingError(`Missing NSE publication timestamp for ${filing.nseSeqId}`);
  }
  return {
    nseSeqId: filing.nseSeqId,
    symbol: filing.symbol,
    periodEnd: filing.periodEnd,
    basis: filing.basis,
    taxonomy: taxonomyFromUrl(filing.xbrlUrl),
    sourceXbrlUrl: filing.xbrlUrl,
    reportedAt: filing.publishedAt,
  };
}

function identityText(xml, localName) {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${localName}(?=\\s|>)([^>]*)>([^<]*)<\\/(?:[A-Za-z_][\\w.-]*:)?${localName}\\s*>`,
    'g',
  );
  for (const match of String(xml).matchAll(pattern)) {
    if (/(?:^|\s)contextRef\s*=\s*(["'])OneD\1(?:\s|$)/.test(match[1])) return match[2].trim();
  }
  return null;
}

function oneDPeriodEnd(xml) {
  const context = /<(?:[A-Za-z_][\w.-]*:)?context(?=\s|>)([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?context\s*>/g;
  for (const match of String(xml).matchAll(context)) {
    if (!/(?:^|\s)id\s*=\s*(["'])OneD\1(?:\s|$)/.test(match[1])) continue;
    return /<(?:[A-Za-z_][\w.-]*:)?endDate\s*>(\d{4}-\d{2}-\d{2})<\/(?:[A-Za-z_][\w.-]*:)?endDate\s*>/.exec(match[2])?.[1] ?? null;
  }
  return null;
}

function validateFilingIdentity(xml, row, parsed) {
  const periodEnd = oneDPeriodEnd(xml);
  if (periodEnd !== row.periodEnd) {
    throw new PermanentFilingError(`XBRL OneD period ${periodEnd ?? 'missing'} does not match ${row.periodEnd}`);
  }

  const basis = identityText(xml, 'NatureOfReportStandaloneConsolidated')?.toLowerCase();
  if (basis !== row.basis) {
    throw new PermanentFilingError(`XBRL basis ${basis ?? 'missing'} does not match ${row.basis}`);
  }

  if (parsed.taxonomy !== row.taxonomy) {
    throw new PermanentFilingError(`XBRL taxonomy ${parsed.taxonomy} does not match ${row.taxonomy}`);
  }
}

function databaseRow(row) {
  return {
    nseSeqId: row.nse_seq_id,
    symbol: row.symbol,
    periodEnd: calendarDate(row.period_end),
    basis: row.basis,
    taxonomy: row.taxonomy,
    sourceXbrlUrl: row.source_xbrl_url,
    reportedAt: new Date(row.reported_at).toISOString(),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    supersededBySeqId: row.superseded_by_seq_id,
  };
}

export function createQuarterlyRepository(pool) {
  return {
    async getActiveSymbols() {
      const result = await pool.query('SELECT symbol FROM market_universe ORDER BY symbol');
      return result.rows.map((row) => row.symbol);
    },

    async getDiscoveryWatermark() {
      const result = await pool.query('SELECT max(reported_at) AS reported_at FROM quarterly_results');
      return result.rows[0]?.reported_at ? new Date(result.rows[0].reported_at).toISOString() : null;
    },

    async getExistingSeqIds(seqIds) {
      if (seqIds.length === 0) return [];
      const result = await pool.query(`
        SELECT nse_seq_id
        FROM quarterly_results
        WHERE nse_seq_id = ANY($1::text[])
      `, [seqIds]);
      return result.rows.map((row) => row.nse_seq_id);
    },

    async insertFilings(filings) {
      const inserted = [];
      for (const filing of filings) {
        const result = await pool.query(`
          INSERT INTO quarterly_results (
            nse_seq_id, symbol, period_end, basis, taxonomy, source_xbrl_url, reported_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (nse_seq_id) DO NOTHING
          RETURNING nse_seq_id
        `, [
          filing.nseSeqId, filing.symbol, filing.periodEnd, filing.basis,
          filing.taxonomy, filing.sourceXbrlUrl, filing.reportedAt,
        ]);
        if (result.rowCount > 0) inserted.push(filing);
      }
      return inserted;
    },

    async claimNextDue(now) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`
          WITH candidate AS (
            SELECT nse_seq_id
            FROM quarterly_results
            WHERE superseded_by_seq_id IS NULL
              AND attempt_count < 3
              AND (
                status = 'pending'
                OR (status = 'retry' AND next_retry_at <= $1)
                OR (status = 'processing' AND last_attempt_at <= $1::timestamptz - interval '15 minutes')
              )
            ORDER BY period_end DESC, reported_at DESC, nse_seq_id DESC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE quarterly_results AS result
          SET status = 'processing',
              last_attempt_at = $1,
              attempt_count = result.attempt_count + 1
          FROM candidate
          WHERE result.nse_seq_id = candidate.nse_seq_id
          RETURNING result.*
        `, [now.toISOString()]);
        await client.query('COMMIT');
        return result.rows[0] ? databaseRow(result.rows[0]) : null;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markProcessed(nseSeqId, values, now) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query(`
          UPDATE quarterly_results
          SET status = 'processed', revenue_inr = $2, calculated_ebitda_inr = $3,
              net_profit_inr = $4, ebitda_components_inr = $5::jsonb,
              next_retry_at = NULL, error = $6, last_attempt_at = $7
          WHERE nse_seq_id = $1
          RETURNING symbol, period_end, basis, reported_at
        `, [
          nseSeqId, values.revenueInr, values.calculatedEbitdaInr, values.netProfitInr,
          JSON.stringify(values.componentsInr), values.issues.length ? values.issues.join(', ') : null,
          now.toISOString(),
        ]);
        const row = current.rows[0];
        if (!row) throw new Error(`Quarterly filing ${nseSeqId} disappeared while processing`);
        await client.query(`
          UPDATE quarterly_results
          SET superseded_by_seq_id = $1
          WHERE nse_seq_id <> $1
            AND symbol = $2 AND period_end = $3 AND basis = $4
            AND reported_at < $5 AND superseded_by_seq_id IS NULL
        `, [nseSeqId, row.symbol, row.period_end, row.basis, row.reported_at]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markRetry(nseSeqId, error, nextRetryAt, now) {
      await pool.query(`
        UPDATE quarterly_results
        SET status = 'retry', error = $2, next_retry_at = $3, last_attempt_at = $4
        WHERE nse_seq_id = $1
      `, [nseSeqId, error, nextRetryAt.toISOString(), now.toISOString()]);
    },

    async markFailed(nseSeqId, error, now) {
      await pool.query(`
        UPDATE quarterly_results
        SET status = 'failed', error = $2, next_retry_at = NULL, last_attempt_at = $3
        WHERE nse_seq_id = $1
      `, [nseSeqId, error, now.toISOString()]);
    },
  };
}

export async function ingestDiscoveredFilings({ filings, source, repository }) {
  const activeSymbols = new Set(await repository.getActiveSymbols());
  const counts = { discovered: 0, inserted: 0, rejected: 0 };
  const candidates = [];
  for (const filing of filings) {
    if (!activeSymbols.has(filing.symbol)) continue;
    try {
      candidates.push(pendingRow(filing));
    } catch (error) {
      if (!(error instanceof PermanentFilingError)) throw error;
      counts.rejected += 1;
    }
  }

  const existing = new Set(await repository.getExistingSeqIds(
    candidates.map((candidate) => candidate.nseSeqId),
  ));
  const newCurrent = candidates.filter((candidate) => !existing.has(candidate.nseSeqId));
  const rowsToInsert = [...newCurrent];
  const historyBySymbol = new Map();
  const historyKeys = new Set();

  for (const current of newCurrent) {
    const key = `${current.symbol}|${current.periodEnd}|${current.basis}`;
    if (historyKeys.has(key)) continue;
    historyKeys.add(key);
    if (!historyBySymbol.has(current.symbol)) {
      historyBySymbol.set(current.symbol, await source.fetchHistory(current.symbol));
    }
    const history = historyBySymbol.get(current.symbol);
    if (!history.some((filing) => filing.nseSeqId === current.nseSeqId)) {
      throw new Error(`NSE history for ${current.symbol} does not yet contain ${current.nseSeqId}`);
    }

    const periods = new Set(Object.values(comparisonPeriods(current.periodEnd)));
    for (const filing of history) {
      if (filing.basis !== current.basis || !periods.has(filing.periodEnd)) continue;
      try {
        rowsToInsert.push(pendingRow(filing));
      } catch (error) {
        if (!(error instanceof PermanentFilingError)) throw error;
        counts.rejected += 1;
      }
    }
  }

  const inserted = await repository.insertFilings(rowsToInsert);
  const currentIds = new Set(newCurrent.map((current) => current.nseSeqId));
  counts.discovered = inserted.filter((row) => currentIds.has(row.nseSeqId)).length;
  counts.inserted = inserted.length;
  return counts;
}

export async function discoverLatestFilings({ source, repository, pageSize = 200 }) {
  const watermark = await repository.getDiscoveryWatermark();
  const counts = { discovered: 0, inserted: 0, rejected: 0 };
  let page = 1;

  while (true) {
    const result = await source.fetchLatestPage({ page, size: pageSize });
    const pageCounts = await ingestDiscoveredFilings({ filings: result.filings, source, repository });
    counts.discovered += pageCounts.discovered;
    counts.inserted += pageCounts.inserted;
    counts.rejected += pageCounts.rejected;

    const reachedWatermark = watermark && result.filings.some((filing) => filing.publishedAt <= watermark);
    const reachedEnd = page * pageSize >= result.totalCount || result.filings.length === 0;
    if (reachedWatermark || reachedEnd || !watermark) break;
    page += 1;
  }

  return counts;
}

export async function processDueFilings({ source, repository, now = new Date(), concurrency = 1 }) {
  const counts = { processed: 0, retried: 0, failed: 0 };

  async function processQueue() {
    while (true) {
      const row = await repository.claimNextDue(now);
      if (!row) break;

      try {
        const xml = await source.fetchXbrl(row.sourceXbrlUrl);
        let parsed;
        try {
          parsed = parseQuarterlyXbrl(xml);
          validateFilingIdentity(xml, row, parsed);
        } catch (error) {
          throw error instanceof PermanentFilingError
            ? error
            : new PermanentFilingError(error.message);
        }
        await repository.markProcessed(row.nseSeqId, parsed, now);
        counts.processed += 1;
      } catch (error) {
        if (error instanceof PermanentFilingError || row.attemptCount >= 3) {
          await repository.markFailed(row.nseSeqId, error.message, now);
          counts.failed += 1;
        } else {
          const delay = RETRY_DELAYS_MS[row.attemptCount - 1];
          await repository.markRetry(row.nseSeqId, error.message, new Date(now.getTime() + delay), now);
          counts.retried += 1;
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.floor(Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, () => processQueue()));
  return counts;
}

export async function runQuarterlyResultsWorker(options) {
  const discovery = await discoverLatestFilings(options);
  const processing = await processDueFilings(options);
  return { discovery, processing };
}
