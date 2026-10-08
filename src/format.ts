const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatCents = (cents: number) => usd.format(cents / 100);

const pad = (n: number) => String(n).padStart(2, "0");

/** 5400 → "1:30". Tracked time in the app is always H:MM. */
export const formatSeconds = (seconds: number) => `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}`;

/** "2026-10-06" → that local calendar day. */
function day(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "2026-10-06" → "Tue, Oct 6". */
export function formatDay(date: string) {
  return day(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "2026-10-06" → "Oct 6". */
export function formatMonthDay(date: string) {
  return day(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Oct 5 – Oct 11, 2026", or with both years when they differ. */
export function formatRange(start: string, end: string) {
  const [sy, ey] = [start.slice(0, 4), end.slice(0, 4)];
  return sy === ey ? `${formatMonthDay(start)} – ${formatMonthDay(end)}, ${ey}` : `${formatMonthDay(start)}, ${sy} – ${formatMonthDay(end)}, ${ey}`;
}

/** A Date as the local calendar day, YYYY-MM-DD (what `<input type="date">` holds). */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Unix seconds → local "HH:MM" (what `<input type="time">` holds). */
export function localTime(unix: number) {
  const d = new Date(unix * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 3723 → "1:02:03". The running Timer. */
export const formatClock = (seconds: number) => `${formatSeconds(seconds)}:${pad(seconds % 60)}`;

/** 45000 → "12.5". Decimal hours, up to 2dp, for totals that go with money. */
export const formatHours = (seconds: number) => String(Number((seconds / 3600).toFixed(2)));

/** 5400 → "1.50". Invoice hours, always 2dp. */
export const formatInvoiceHours = (seconds: number) => (seconds / 3600).toFixed(2);

/** "Acme · Website", or just "Acme". */
export const clientAndProject = (x: { clientName: string; projectName: string | null }) =>
  x.projectName ? `${x.clientName} · ${x.projectName}` : x.clientName;

/** "2026-10-07" → "Oct 7, 2026". Dates a client reads. */
export function formatDate(date: string) {
  return day(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
