function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
}

export function todayIstDate(date = new Date()) {
  const parts = istParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isNseMarketOpenIst(date = new Date()) {
  const parts = istParts(date);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function isFreshLiveTick(lastTickAt, now = new Date(), maxAgeSeconds = 90) {
  if (!lastTickAt) return false;
  const tickMs = new Date(lastTickAt).getTime();
  if (!Number.isFinite(tickMs)) return false;
  return now.getTime() - tickMs <= maxAgeSeconds * 1000;
}
