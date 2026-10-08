import type { TimeEntry } from "@/lib/time-entries/types";

/** Entries arrive newest first; keep that order within and across days. */
export function byDay(entries: TimeEntry[]) {
  const days = new Map<string, TimeEntry[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  return [...days];
}
