import { parseNsePeriodEnd } from './quarter-periods.mjs';

const NSE_HOME = 'https://www.nseindia.com/';
const NSE_RESULTS_ENDPOINT = 'https://www.nseindia.com/api/integrated-filing-results';
const NSE_XBRL_PREFIX = 'https://nsearchives.nseindia.com/corporate/xbrl/';

const BASE_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-integrated',
  'User-Agent': 'Mozilla/5.0 (compatible; BoardroomX/1.0)',
};

function cookiesFrom(response) {
  const values = response.headers?.getSetCookie?.() ?? [];
  if (values.length > 0) return values.map((value) => value.split(';', 1)[0]).join('; ');

  const value = response.headers?.get?.('set-cookie');
  return value ? value.split(';', 1)[0] : '';
}

async function assertHttpOk(response, endpoint) {
  if (response.ok) return;
  const body = typeof response.text === 'function' ? await response.text() : '';
  throw new Error(`${endpoint} failed with status ${response.status}: ${body}`);
}

async function parseJson(response, endpoint) {
  await assertHttpOk(response, endpoint);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${endpoint} returned status ${response.status} with malformed JSON: ${error.message}`);
  }
}

function parseNseTimestamp(value) {
  const match = /^(\d{2})-([A-Z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/i.exec(String(value).trim());
  const months = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const month = match && months[match[2].toUpperCase()];
  if (!match || month == null) throw new Error(`Invalid NSE publication timestamp: ${value}`);

  const utcMillis = Date.UTC(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]) - 5,
    Number(match[5]) - 30,
    Number(match[6]),
  );
  return new Date(utcMillis).toISOString();
}

function optionalTimestamp(value) {
  return value ? parseNseTimestamp(value) : null;
}

export function normalizeNseQuarterlyFiling(row) {
  const basis = String(row.consolidated).trim().toLowerCase();
  if (!['consolidated', 'standalone'].includes(basis)) {
    throw new Error(`Unsupported NSE filing basis: ${row.consolidated}`);
  }

  const typeSub = String(row.type_Sub ?? '').trim();
  return {
    nseSeqId: String(row.seq_Id),
    symbol: String(row.symbol).trim().toUpperCase(),
    companyName: String(row.smName ?? row.cmName ?? '').trim(),
    periodEnd: parseNsePeriodEnd(row.qe_Date),
    basis,
    publishedAt: optionalTimestamp(row.broadcast_Date),
    typeSub,
    revisedAt: optionalTimestamp(row.revised_Date),
    revisionRemark: row.revision_Remark == null ? null : String(row.revision_Remark),
    isRevision: typeSub.toLowerCase() !== 'original' || row.revised_Date != null,
    xbrlUrl: String(row.xbrl),
  };
}

export function createNseQuarterlySource({
  fetchImpl = fetch,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs = [500, 1_500],
} = {}) {
  let cookieHeader;

  async function fetchNse(url, options) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchImpl(url, options);
      } catch (error) {
        if (attempt >= retryDelaysMs.length) {
          throw new Error(`${url} network error after ${attempt + 1} attempts: ${error.message}`, {
            cause: error,
          });
        }
        await sleepImpl(retryDelaysMs[attempt]);
      }
    }
  }

  async function warmSession() {
    if (cookieHeader !== undefined) return;
    const response = await fetchNse(NSE_HOME, { headers: BASE_HEADERS });
    await assertHttpOk(response, NSE_HOME);
    cookieHeader = cookiesFrom(response);
  }

  async function requestPage({ page, size, symbol }) {
    await warmSession();
    const url = new URL(NSE_RESULTS_ENDPOINT);
    url.searchParams.set('index', 'equities');
    url.searchParams.set('type', 'Integrated Filing- Financials');
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    if (symbol) url.searchParams.set('symbol', symbol);

    const headers = { ...BASE_HEADERS };
    if (cookieHeader) headers.Cookie = cookieHeader;
    const response = await fetchNse(url, { headers });
    const payload = await parseJson(response, url.toString());
    if (!payload || !Array.isArray(payload.data) || !Number.isFinite(Number(payload.totalCount))) {
      throw new Error(`${url} returned status ${response.status} with malformed JSON: invalid result shape`);
    }

    return {
      filings: payload.data.map(normalizeNseQuarterlyFiling),
      page,
      size: Number(payload.size ?? size),
      totalCount: Number(payload.totalCount),
    };
  }

  return {
    fetchLatestPage({ page = 1, size = 200 } = {}) {
      return requestPage({ page, size });
    },

    async fetchHistory(symbol) {
      const normalizedSymbol = String(symbol).trim().toUpperCase();
      if (!normalizedSymbol) throw new Error('NSE symbol is required');
      return (await requestPage({ page: 1, size: 200, symbol: normalizedSymbol })).filings;
    },

    async fetchXbrl(url) {
      if (!String(url).startsWith(NSE_XBRL_PREFIX)) {
        throw new Error(`Expected an official NSE XBRL URL: ${url}`);
      }
      const response = await fetchNse(url, {
        headers: {
          Accept: 'application/xml,text/xml,*/*',
          Referer: NSE_HOME,
          'User-Agent': BASE_HEADERS['User-Agent'],
        },
      });
      await assertHttpOk(response, url);
      return response.text();
    },
  };
}
