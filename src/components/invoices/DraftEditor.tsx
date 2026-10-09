import { useState } from "react";
import { InvoiceHeading } from "@/components/invoices/InvoiceHeading";
import { InvoiceLines } from "@/components/invoices/InvoiceLines";
import { TimeEntryModal } from "@/components/time-entries/TimeEntryModal";
import { Confirm } from "@/components/ui/Confirm";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { Modal } from "@/components/ui/Modal";
import { addInvoiceEntry, deleteInvoice, removeInvoiceEntry, sendInvoice, setInvoiceNetDays, setInvoiceTimesheet } from "@/integrations/tauri/commands";
import { formatDay, formatSeconds } from "@/lib/format";
import { entryLabel } from "@/lib/invoices/entryLabel";
import type { Invoice } from "@/lib/invoices/types";
import { label } from "@/lib/labels";
import type { TimeEntry } from "@/lib/time-entries/types";

type Props = {
  invoice: Invoice;
  update: (action: Promise<Invoice>) => Promise<void>;
  error: string | null;
  fail: (err: unknown) => void;
  onChange: () => void;
  onDeleted: () => void;
};

export function DraftEditor({ invoice, update, error, fail, onChange, onDeleted }: Props) {
  const id = invoice.id;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  return (
    <>
      <InvoiceHeading invoice={invoice} />
      <InvoiceLines invoice={invoice} />
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={invoice.timesheet} onChange={(e) => update(setInvoiceTimesheet(id, e.target.checked))} /> Timesheet page
        </label>
        <label>
          Net{" "}
          <input
            key={invoice.netDaysOverride ?? "default"}
            className="short"
            aria-label="Net days"
            inputMode="numeric"
            placeholder={String(invoice.netDays)}
            defaultValue={invoice.netDaysOverride ?? ""}
            onBlur={(e) => e.target.value !== String(invoice.netDaysOverride ?? "") && update(setInvoiceNetDays(id, e.target.value))}
          />{" "}
          days
        </label>
        <button className="ghost" onClick={() => setDeleting(true)}>
          Delete
        </button>
        <button className="primary" disabled={!invoice.entries.length} onClick={() => setSending(true)}>
          Mark as Sent
        </button>
      </div>
      {invoice.newInPeriod > 0 && (
        <p className="hint">
          {invoice.newInPeriod} new uninvoiced {invoice.newInPeriod === 1 ? "entry" : "entries"} in this period
        </p>
      )}
      <ErrorLine error={error} />

      <section className="day" aria-label="Time entries">
        <h2>
          <span>Time entries</span>
          <button className="primary" disabled={!invoice.available.length} onClick={() => setAdding(true)}>
            + Add entry
          </button>
        </h2>
        {invoice.entries.length === 0 && <p className="hint">No time entries on this {label.invoice}.</p>}
        <ul className="rows">
          {invoice.entries.map((e) => (
            <li key={e.id} className="row entry">
              <button onClick={() => setEditing(e)}>
                <span className="who">{formatDay(e.date)}</span>
                <span className="note">{[e.projectName, e.note].filter(Boolean).join(" · ")}</span>
                <span className="num">{formatSeconds(e.seconds)}</span>
              </button>
              <button className="ghost icon" aria-label={`Remove ${e.note ?? formatDay(e.date)}`} onClick={() => update(removeInvoiceEntry(id, e.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {adding && (
        <Modal title="Add time entry" onClose={() => setAdding(false)}>
          <ul className="rows">
            {invoice.available.map((e) => (
              <li key={e.id} className="row entry">
                <button
                  onClick={() => {
                    setAdding(false);
                    update(addInvoiceEntry(id, e.id));
                  }}
                >
                  {entryLabel(e)}
                </button>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <TimeEntryModal
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
      {sending && (
        <Confirm
          title={`Seal this ${label.invoice}?`}
          action="Mark as Sent"
          onClose={() => setSending(false)}
          onConfirm={() => {
            setSending(false);
            update(sendInvoice(id));
          }}
        >
          <p>
            {invoice.number ?? "It gets the next invoice number"}, issued today, due in {invoice.netDays} days. Its rates and details freeze and its time entries
            lock. Sending it to {invoice.clientName} is up to you.
          </p>
        </Confirm>
      )}
      {deleting && (
        <Confirm
          title={`Delete ${label.invoice}?`}
          action="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            deleteInvoice(id).then(onDeleted, (err) => {
              setDeleting(false);
              fail(err);
            })
          }
        >
          <p>Its time entries go back to {label.uninvoiced}.</p>
          {invoice.number && <p className="error">{invoice.number} won't be used again, leaving a gap in your invoice numbers.</p>}
        </Confirm>
      )}
    </>
  );
}
