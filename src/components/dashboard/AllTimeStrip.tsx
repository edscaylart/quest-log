import type { Dashboard } from "@/lib/dashboard/types";
import { formatBrl, formatCents } from "@/lib/format";
import { label } from "@/lib/labels";

export function AllTimeStrip({ allTime, usdBrl }: { allTime: Dashboard["allTime"]; usdBrl: number | null }) {
  return (
    <section className="strip" aria-label="All time">
      <span>
        {label.invoicedUnpaid} {formatCents(allTime.invoicedUnpaidCents)} · {allTime.overdue} overdue {label.invoices}
      </span>
      <span>
        {label.uninvoiced} {formatCents(allTime.uninvoicedCents)}
        {usdBrl && <span className="brl"> {formatBrl(allTime.uninvoicedCents, usdBrl)}</span>}
      </span>
    </section>
  );
}
