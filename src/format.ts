const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatCents = (cents: number) => usd.format(cents / 100);

const pad = (n: number) => String(n).padStart(2, "0");

/** 5400 → "1:30". Tracked time in the app is always H:MM. */
export const formatSeconds = (seconds: number) => `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}`;

/** "2026-10-06" → "Tue, Oct 6". */
export function formatDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** A Date as the local calendar day, YYYY-MM-DD (what `<input type="date">` holds). */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Unix seconds → local "HH:MM" (what `<input type="time">` holds). */
export function localTime(unix: number) {
  const d = new Date(unix * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
