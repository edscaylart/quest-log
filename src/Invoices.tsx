import { useEffect, useState, type ReactNode } from "react";
import { EntryModal } from "./Log";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useNav } from "@/hooks/useNav";
import {
  addInvoiceEntry,
  createDraft,
  deleteInvoice,
  draftCandidates,
  getInvoice,
  listClients,
  listInvoices,
  markPaid,
  removeInvoiceEntry,
  sendInvoice,
  setInvoiceNetDays,
  setInvoiceTimesheet,
  unmarkPaid,
  unsealInvoice,
} from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";
import type { PeriodInput } from "@/lib/dashboard/types";
import { toCoreError } from "@/lib/errors";
import { formatCents, formatDay, formatInvoiceHours, formatMonthDay, formatRange, formatSeconds, localDate } from "@/lib/format";
import type { DraftCandidates, Invoice, InvoiceState, InvoiceSummary } from "@/lib/invoices/types";
import { label } from "@/lib/labels";
import type { TimeEntry } from "@/lib/time-entries/types";

const states: InvoiceState[] = ["draft", "sent", "paid"];

export function Invoices({ version, onChange }: { version: number; onChange: () => void }) {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { push } = useNav();

  useEffect(() => {
    listInvoices().then(setInvoices);
  }, [version]);

  return (
    <>
      <h1>{label.invoices}</h1>
      <button className="primary" onClick={() => setCreating(true)}>
        + New {label.invoice}
      </button>
      {invoices?.length === 0 && <p className="hint">No {label.invoices} yet.</p>}
      {states.map((state) => {
        const shown = invoices?.filter((i) => i.state === state) ?? [];
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
      })}
      {creating && (
        <NewDraftModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            push({ kind: "invoice", id });
            onChange();
          }}
        />
      )}
    </>
  );
}

/** Which period to list: the core default, a completed preset, or custom days. */
type Choice = { kind: "default" } | { kind: "2w" | "month" } | { kind: "custom"; start: string; end: string };

const choices = [
  { kind: "2w", title: "Last 2 weeks" },
  { kind: "month", title: "Last month" },
] as const;

function periodInput(choice: Choice): PeriodInput | null {
  if (choice.kind === "default") return null;
  if (choice.kind === "custom") return { preset: "custom", offset: 0, start: choice.start, end: choice.end };
  // Last month is the previous calendar month; last 2 weeks is last week and this one, up to today.
  return { preset: choice.kind, offset: choice.kind === "month" ? -1 : 0, start: null, end: null };
}

const entryLabel = (e: TimeEntry) => [formatDay(e.date), e.projectName, e.note, formatSeconds(e.seconds)].filter(Boolean).join(" · ");

export function NewDraftModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState(0);
  const [choice, setChoice] = useState<Choice>({ kind: "default" });
  const [candidates, setCandidates] = useState<DraftCandidates | null>(null);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listClients().then((all) => {
      // A retired client only while it has time left to bill.
      const list = all.filter((c) => !c.archived || c.hasAvailable);
      setClients(list);
      setClientId(list[0]?.id ?? 0);
    });
  }, []);

  const custom = choice.kind === "custom" ? choice : null;
  useEffect(() => {
    if (!clientId) return;
    let current = true;
    draftCandidates(clientId, periodInput(choice)).then(
      (c) => {
        if (!current) return;
        setCandidates(c);
        setError(null);
      },
      (err) => current && setError(toCoreError(err).message),
    );
    return () => {
      current = false;
    };
  }, [clientId, choice.kind, custom?.start, custom?.end]);

  const period = candidates?.period;
  const toggle = (id: number) => {
    const next = new Set(unticked);
    if (!next.delete(id)) next.add(id);
    setUnticked(next);
  };

  async function create() {
    if (!period || !candidates) return;
    setBusy(true);
    try {
      const entryIds = candidates.entries.map((e) => e.id).filter((id) => !unticked.has(id));
      const invoice = await createDraft({ clientId, start: period.start, end: period.end, entryIds });
      onCreated(invoice.id);
    } catch (err) {
      setError(toCoreError(err).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`New ${label.invoice}`} onClose={onClose}>
      {clients?.length === 0 ? (
        <p className="hint">Add a {label.client} first.</p>
      ) : (
        <>
          <Field id="draft-client" label={label.client} error={null}>
            <select
              id="draft-client"
              value={clientId}
              onChange={(e) => {
                setClientId(Number(e.target.value));
                setChoice({ kind: "default" });
              }}
            >
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? `${c.name} (${label.archived})` : c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="segmented" role="group" aria-label="Period">
            {choices.map((c) => (
              <button key={c.kind} type="button" aria-pressed={choice.kind === c.kind} onClick={() => setChoice({ kind: c.kind })}>
                {c.title}
              </button>
            ))}
            <button type="button" aria-pressed={!!custom} onClick={() => period && !custom && setChoice({ kind: "custom", ...period })}>
              Custom
            </button>
          </div>
          {custom ? (
            <div className="pair">
              <Field id="draft-start" label="Start" error={null}>
                <input id="draft-start" type="date" value={custom.start} onChange={(e) => setChoice({ ...custom, start: e.target.value })} />
              </Field>
              <Field id="draft-end" label="End" error={null}>
                <input id="draft-end" type="date" value={custom.end} onChange={(e) => setChoice({ ...custom, end: e.target.value })} />
              </Field>
            </div>
          ) : (
            period && <p>{formatRange(period.start, period.end)}</p>
          )}
          {candidates && candidates.older > 0 && candidates.olderSince && period && (
            <p className="hint">
              <button type="button" className="link" onClick={() => setChoice({ kind: "custom", start: candidates.olderSince!, end: period.end })}>
                {candidates.older} older uninvoiced {candidates.older === 1 ? "entry" : "entries"} — include?
              </button>
            </p>
          )}
          {candidates?.entries.length === 0 && <p className="hint">No uninvoiced time in this period.</p>}
          <ul className="rows">
            {candidates?.entries.map((e) => (
              <li key={e.id} className="row">
                <label>
                  <input type="checkbox" checked={!unticked.has(e.id)} onChange={() => toggle(e.id)} /> {entryLabel(e)}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || !candidates} onClick={create}>
          Create
        </button>
      </div>
    </Modal>
  );
}

/** A Draft opens editable; Sent and Paid open read-only with their state actions. */
export function InvoiceDetail({ id, version, onChange, onDeleted }: { id: number; version: number; onChange: () => void; onDeleted: () => void }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvoice(id).then(setInvoice);
  }, [id, version]);

  if (!invoice) return null;
  const update = (action: Promise<Invoice>) =>
    action.then(
      (next) => {
        setInvoice(next);
        setError(null);
        onChange();
      },
      (err) => setError(toCoreError(err).message),
    );
  const props = { invoice, update, error, setError, onChange, onDeleted };
  return invoice.state === "draft" ? <DraftEditor {...props} /> : <SealedDetail {...props} />;
}

type DetailProps = {
  invoice: Invoice;
  update: (action: Promise<Invoice>) => Promise<void>;
  error: string | null;
  setError: (error: string | null) => void;
  onChange: () => void;
  onDeleted: () => void;
};

function Heading({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <h1>
        {label.invoiceState[invoice.state]} {label.invoice} · {invoice.clientName}
      </h1>
      <p>{[invoice.number, formatRange(invoice.period.start, invoice.period.end)].filter(Boolean).join(" · ")}</p>
    </>
  );
}

function Lines({ invoice }: { invoice: Invoice }) {
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

function ErrorLine({ error }: { error: string | null }) {
  return (
    error && (
      <p className="error" role="alert">
        {error}
      </p>
    )
  );
}

/** Asks before acting; `onConfirm` acts. */
function Confirm({ title, children, action, onClose, onConfirm }: { title: string; children: ReactNode; action: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      {children}
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {action}
        </button>
      </div>
    </Modal>
  );
}

function DraftEditor({ invoice, update, error, setError, onChange, onDeleted }: DetailProps) {
  const id = invoice.id;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  const fail = (err: unknown) => setError(toCoreError(err).message);

  return (
    <>
      <Heading invoice={invoice} />
      <Lines invoice={invoice} />
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
        <EntryModal
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

/** Sent or Paid: read-only, with its state actions. */
function SealedDetail({ invoice, update, error, setError }: DetailProps) {
  const id = invoice.id;
  const [exporting, setExporting] = useState(false);
  const exportPdf = () => {
    if (!invoice.snapshot) return;
    setExporting(true);
    const sent = { ...invoice, snapshot: invoice.snapshot };
    // react-pdf is big; load it on first export, not at startup.
    import("./InvoicePdf")
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
      <Heading invoice={invoice} />
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
      <Lines invoice={invoice} />
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
