import { formatCents, formatInvoiceHours } from "@/lib/format";
import type { Invoice } from "@/lib/invoices/types";

export function InvoiceLines({ invoice }: { invoice: Invoice }) {
  return (
    <div className="scroll-x">
      <table className="figures-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Hours</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.projectId ?? "general"}>
              <td>{l.description}</td>
              <td className="num">{formatInvoiceHours(l.seconds)}</td>
              <td className="num">{formatCents(l.rateCents)}</td>
              <td className="num">{formatCents(l.amountCents)}</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
            <th className="num">{formatInvoiceHours(invoice.seconds)}</th>
            <th />
            <th className="num">{formatCents(invoice.totalCents)}</th>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
