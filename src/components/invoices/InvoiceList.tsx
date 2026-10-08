import { useNav } from "@/hooks/useNav";
import { formatCents, formatRange } from "@/lib/format";
import type { InvoiceState, InvoiceSummary } from "@/lib/invoices/types";
import { label } from "@/lib/labels";

const states: InvoiceState[] = ["draft", "sent", "paid"];

export function InvoiceList({ invoices }: { invoices: InvoiceSummary[] }) {
  const { push } = useNav();
  return states.map((state) => {
    const shown = invoices.filter((i) => i.state === state);
    return (
      shown.length > 0 && (
        <section key={state} className="day" aria-label={label.invoiceState[state]}>
          <h2>{label.invoiceState[state]}</h2>
          <ul className="rows">
            {shown.map((i) => (
              <li key={i.id} className="row entry">
                <button onClick={() => push({ kind: "invoice", id: i.id })}>
                  <span className="who">{[i.number, i.clientName].filter(Boolean).join(" · ")}</span>
                  <span className="note">
                    {formatRange(i.period.start, i.period.end)}
                    {i.overdue && <strong className="error"> · Overdue</strong>}
                  </span>
                  <span className="num">{formatCents(i.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )
    );
  });
}
