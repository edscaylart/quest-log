// Hand-mirrored from src-tauri/src/core/dashboard.rs. Canonical domain terms only.

export type Preset = "1w" | "2w" | "3w" | "month" | "custom";
/** A preset's current period, stepped `offset` period lengths; `start`/`end` (YYYY-MM-DD) are for custom. */
export type PeriodInput = { preset: Preset; offset: number; start: string | null; end: string | null };
/** Local days, both included. */
export type Period = { start: string; end: string };
/** Earnings: uninvoiced + invoiced-unpaid + paid always equals earned. */
export type Figures = { seconds: number; earnedCents: number; uninvoicedCents: number; invoicedUnpaidCents: number; paidCents: number };
export type Dashboard = {
  /** Local days, both included. */
  period: { start: string; end: string };
  total: Figures;
  /** Clients with time in the period, most hours first. */
  clients: (Figures & { clientId: number; clientName: string })[];
  /** Per day, or per Monday week when `weekly`. */
  buckets: { start: string; seconds: number }[];
  weekly: boolean;
  /** Not tied to the period. `overdue` counts Sent invoices past due. */
  allTime: { invoicedUnpaidCents: number; overdue: number; uninvoicedCents: number };
};
