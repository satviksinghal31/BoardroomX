const DHAN_API_BASE = 'https://api.dhan.co/v2';
const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';

export function chunkSecurityIds(ids, chunkSize = 1000) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) out.push(ids.slice(i, i + chunkSize));
  return out;
}

async function parseResponse(response, label) {
  if (response.ok) {
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('text/')) return response.text();
    return response.json();
  }
  const body = typeof response.text === 'function' ? await response.text() : '';
  throw new Error(`${label} failed (${response.status}): ${body}`);
}

export function createDhanClient({ clientId, getAccessToken, fetchImpl = fetch }) {
  if (!clientId) throw new Error('clientId is required');
  if (typeof getAccessToken !== 'function') throw new Error('getAccessToken is required');

  async function post(path, body, label) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${DHAN_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'access-token': token,
        'client-id': clientId,
      },
      body: JSON.stringify(body),
    });
    return parseResponse(response, label);
  }

  return {
    async fetchHistoricalDaily({ securityId, exchangeSegment, fromDate, toDate }) {
      return post('/charts/historical', {
        securityId,
        exchangeSegment,
        instrument: 'EQUITY',
        expiryCode: 0,
        oi: false,
        fromDate,
        toDate,
      }, 'Dhan historical daily');
    },

    async fetchOhlcBySegment(segmentMap) {
      return post('/marketfeed/ohlc', segmentMap, 'Dhan OHLC quote');
    },

    async fetchQuoteBySegment(segmentMap) {
      return post('/marketfeed/quote', segmentMap, 'Dhan quote');
    },

    async fetchScripMasterCsv() {
      const response = await fetchImpl(DHAN_SCRIP_MASTER_URL);
      if (response.ok) return response.text();
      return parseResponse(response, 'Dhan scrip master');
    },
  };
}
