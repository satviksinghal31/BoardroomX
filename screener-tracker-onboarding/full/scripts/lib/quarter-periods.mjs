const QUARTER_ENDS = new Map([
  ['03-31', '12-31'],
  ['06-30', '03-31'],
  ['09-30', '06-30'],
  ['12-31', '09-30'],
]);

const NSE_MONTHS = new Map([
  ['MAR', '03'],
  ['JUN', '06'],
  ['SEP', '09'],
  ['DEC', '12'],
]);

function assertQuarterEnd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !QUARTER_ENDS.has(`${match[2]}-${match[3]}`)) {
    throw new Error(`Expected an exact quarter end, received: ${value}`);
  }

  return { year: Number(match[1]), monthDay: `${match[2]}-${match[3]}` };
}

export function parseNsePeriodEnd(value) {
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(value).trim().toUpperCase());
  const month = match && NSE_MONTHS.get(match[2]);

  if (!match || !month) {
    throw new Error(`Expected an exact NSE quarter end, received: ${value}`);
  }

  const periodEnd = `${match[3]}-${month}-${match[1]}`;
  assertQuarterEnd(periodEnd);
  return periodEnd;
}

export function comparisonPeriods(periodEnd) {
  const { year, monthDay } = assertQuarterEnd(periodEnd);
  const previousYear = monthDay === '03-31' ? year - 1 : year;

  return {
    current: periodEnd,
    previous: `${previousYear}-${QUARTER_ENDS.get(monthDay)}`,
    priorYear: `${year - 1}-${monthDay}`,
  };
}

function parseInteger(value, name) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`${name} must be an integer string`);
  }
  return BigInt(value);
}

function roundRatio(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

export function growthPercent(current, comparison) {
  if (current == null || comparison == null) return null;

  const currentValue = parseInteger(current, 'current');
  const comparisonValue = parseInteger(comparison, 'comparison');
  if (comparisonValue === 0n) return null;

  const denominator = comparisonValue < 0n ? -comparisonValue : comparisonValue;
  const tenthsOfPercent = roundRatio((currentValue - comparisonValue) * 1000n, denominator);
  return Number(tenthsOfPercent) / 10;
}

