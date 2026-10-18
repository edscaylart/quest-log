import type { Figures } from "@/lib/dashboard/types";
import { formatCents, formatSeconds } from "@/lib/format";
import { label } from "@/lib/labels";

/** The figures shown for a Period total and for each Client row. */
/** `cents` marks the figures Home also shows in BRL. */
export const columns: { title: string; value: (f: Figures) => string; cents?: (f: Figures) => number }[] = [
  { title: "Hours", value: (f) => formatSeconds(f.seconds) },
  { title: "Earned", value: (f) => formatCents(f.earnedCents), cents: (f) => f.earnedCents },
  { title: label.uninvoiced, value: (f) => formatCents(f.uninvoicedCents), cents: (f) => f.uninvoicedCents },
  { title: label.invoicedUnpaid, value: (f) => formatCents(f.invoicedUnpaidCents) },
  { title: label.paid, value: (f) => formatCents(f.paidCents) },
];
