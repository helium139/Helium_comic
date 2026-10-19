export function utcMonths(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid UTC date");
  const year = date.getUTCFullYear(); const month = date.getUTCMonth();
  const key = (y, m) => `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
  return {currentPeriod: key(year, month), previousPeriod: key(month ? year : year - 1, month ? month - 1 : 11),
    nextBoundary: Date.UTC(year, month + 1, 1)};
}
export function monthEnd(period) {
  if (typeof period !== "string" || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Invalid accounting month");
  const [year, month] = period.split("-").map(Number);
  return Date.UTC(year, month, 1);
}
