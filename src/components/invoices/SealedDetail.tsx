import { useState } from "react";
import { Confirm } from "@/components/invoices/Confirm";
import { ErrorLine } from "@/components/invoices/ErrorLine";
import { InvoiceHeading } from "@/components/invoices/InvoiceHeading";
import { InvoiceLines } from "@/components/invoices/InvoiceLines";
import { Field } from "@/components/ui/Field";
import { markPaid, unmarkPaid, unsealInvoice } from "@/integrations/tauri/commands";
import { toCoreError } from "@/lib/errors";
import { formatDay, formatMonthDay, formatSeconds, localDate } from "@/lib/format";
import type { Invoice } from "@/lib/invoices/types";
import { label } from "@/lib/labels";

type Props = {
  invoice: Invoice;
  update: (action: Promise<Invoice>) => Promise<void>;
  error: string | null;
  setError: (error: string | null) => void;
};

/** Sent or Paid: read-only, with its state actions. */
export function SealedDetail({ invoice, update, error, setError }: Props) {
  const id = invoice.id;
  const [exporting, setExporting] = useState(false);
  const exportPdf = () => {
    if (!invoice.snapshot) return;
    setExporting(true);
    const sent = { ...invoice, snapshot: invoice.snapshot };
    // react-pdf is big; load it on first export, not at startup.
    import("@/integrations/pdf/invoicePdf")
      .then((pdf) => pdf.exportInvoicePdf(sent))
      .then(() => setError(null), (err) => setError(`Couldn't export the PDF: ${toCoreError(err).message}`))
      .finally(() => setExporting(false));
  };
  const [confirming, setConfirming] = useState<"unseal" | "paid" | "unpaid" | null>(null);
  const [paidDate, setPaidDate] = useState(() => localDate(new Date()));
  const run = (action: Promise<Invoice>) => {
    setConfirming(null);
    update(action);
  };
  const close = () => setConfirming(null);

  return (
    <>
      <InvoiceHeading invoice={invoice} />
      <dl className="facts">
        <dt>Issued</dt>
        <dd>{invoice.issueDate && formatMonthDay(invoice.issueDate)}</dd>
        <dt>Due</dt>
        <dd>
          {invoice.dueDate && formatMonthDay(invoice.dueDate)}
          {invoice.overdue && <strong className="error"> · Overdue</strong>}
        </dd>
        {invoice.paidDate && (
          <>
            <dt>Paid</dt>
            <dd>{formatMonthDay(invoice.paidDate)}</dd>
          </>
        )}
      </dl>
      <InvoiceLines invoice={invoice} />
      <div className="toolbar">
        <button className="ghost" disabled={exporting || !invoice.snapshot} onClick={exportPdf}>
          Export PDF
        </button>
        {invoice.state === "sent" ? (
          <>
            <button className="ghost" onClick={() => setConfirming("unseal")}>
              Unseal
            </button>
            <button className="primary" onClick={() => setConfirming("paid")}>
              Mark Paid
            </button>
          </>
        ) : (
          <button className="ghost" onClick={() => setConfirming("unpaid")}>
            Mark unpaid
          </button>
        )}
      </div>
      <ErrorLine error={error} />

      <section className="day" aria-label="Time entries">
        <h2>
          <span>Time entries</span>
        </h2>
        <ul className="rows">
          {invoice.entries.map((e) => (
            <li key={e.id} className="row">
              <span className="who">{formatDay(e.date)}</span>
              <span className="note">{[e.projectName, e.note].filter(Boolean).join(" · ")}</span>
              <span className="num">{formatSeconds(e.seconds)}</span>
            </li>
          ))}
        </ul>
      </section>

      {confirming === "unseal" && (
        <Confirm title={`Unseal ${label.invoice}?`} action="Unseal" onClose={close} onConfirm={() => run(unsealInvoice(id))}>
          <p>It goes back to a Draft, keeping {invoice.number}. Its time entries unlock and follow live rates until you send it again.</p>
        </Confirm>
      )}
      {confirming === "paid" && (
        <Confirm title="Mark Paid?" action="Mark Paid" onClose={close} onConfirm={() => run(markPaid(id, paidDate))}>
          <Field id="paid-date" label="Paid on" error={null}>
            <input id="paid-date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
        </Confirm>
      )}
      {confirming === "unpaid" && (
        <Confirm title="Mark unpaid?" action="Mark unpaid" onClose={close} onConfirm={() => run(unmarkPaid(id))}>
          <p>It goes back to {label.invoiceState.sent} and its paid date is cleared.</p>
        </Confirm>
      )}
    </>
  );
}
