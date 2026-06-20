function round(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

export function applyTick(state, tick) {
  const next = new Map(state ?? []);
  const symbol = String(tick.symbol ?? '').trim().toUpperCase();
  if (!symbol || !tick.tradeDate || tick.ltp == null) return next;

  const ltp = round(tick.ltp);
  const volume = tick.volume == null ? null : Number(tick.volume);
  const existing = next.get(symbol);
  const sameDay = existing?.trade_date === tick.tradeDate;
  const base = sameDay
    ? existing
    : {
        symbol,
        trade_date: tick.tradeDate,
        open: ltp,
        high: ltp,
        low: ltp,
        ltp,
        prev_close: tick.prevClose == null ? null : round(tick.prevClose),
        volume,
        last_tick_at: tick.lastTickAt ?? new Date().toISOString(),
      };

  if (sameDay) {
    base.high = Math.max(base.high, ltp);
    base.low = Math.min(base.low, ltp);
    base.ltp = ltp;
    if (tick.prevClose != null) base.prev_close = round(tick.prevClose);
    if (volume != null) base.volume = volume;
    base.last_tick_at = tick.lastTickAt ?? new Date().toISOString();
  }

  next.set(symbol, { ...base });
  return next;
}

export function serializeLiveState(state) {
  return [...(state ?? new Map()).values()]
    .map(row => ({ ...row }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}
