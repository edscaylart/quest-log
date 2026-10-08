import type { Dashboard } from "@/lib/dashboard/types";
import { formatCents } from "@/lib/format";
import { label } from "@/lib/labels";

export function AllTimeStrip({ allTime }: { allTime: Dashboard["allTime"] }) {
  return (
    <section className="strip" aria-label="All time">
      <span>
        {label.invoicedUnpaid} {formatCents(allTime.invoicedUnpaidCents)} · {allTime.overdue} overdue {label.invoices}
      </span>
      <span>
        {label.uninvoiced} {formatCents(allTime.uninvoicedCents)}
      </span>
    </section>
  );
}
