import { formatRange } from "@/lib/format";
import type { Invoice } from "@/lib/invoices/types";
import { label } from "@/lib/labels";

export function InvoiceHeading({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <h1>
        {label.invoiceState[invoice.state]} {label.invoice} · {invoice.clientName}
      </h1>
      <p>{[invoice.number, formatRange(invoice.period.start, invoice.period.end)].filter(Boolean).join(" · ")}</p>
    </>
  );
}
