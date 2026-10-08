import type { Preset } from "@/lib/dashboard/types";

export const presets: { id: Preset; title: string }[] = [
  { id: "1w", title: "1W" },
  { id: "2w", title: "2W" },
  { id: "3w", title: "3W" },
  { id: "month", title: "M" },
  { id: "custom", title: "Custom" },
];

/** Custom's own days; null for the other presets. */
type Range = { start: string; end: string } | null;
export type Saved = { preset: Preset; range: Range };

const STORAGE_KEY = "home.period";

// ponytail: a per-device view preference, so browser storage rather than core.
export function loadSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    if (saved && presets.some((p) => p.id === saved.preset)) return saved;
  } catch {}
  return { preset: "1w", range: null };
}

export function save(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {}
}
