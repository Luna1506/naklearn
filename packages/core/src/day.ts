export const DAY_START_HOUR = 4;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y!, m!, d!];
}

/** Lerntag (YYYY-MM-DD, lokale Zeit) eines Zeitpunkts; der Tag beginnt um 04:00. */
export function studyDay(ms: number): string {
  return fmt(new Date(ms - DAY_START_HOUR * 3_600_000));
}

/** Beginn eines Lerntags (04:00 lokale Zeit) in ms. */
export function dayStartMs(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime();
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return fmt(new Date(y, m - 1, d + n, 12));
}

/** Anzahl Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
