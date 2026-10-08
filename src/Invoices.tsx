import { useEffect, useState } from "react";
import {
  addInvoiceEntry,
  createDraft,
  deleteInvoice,
  draftCandidates,
  getInvoice,
  listClients,
  listInvoices,
  removeInvoiceEntry,
  setInvoiceTimesheet,
  toCoreError,
  type Client,
  type DraftCandidates,
  type Invoice,
  type InvoiceState,
  type InvoiceSummary,
  type PeriodInput,
  type TimeEntry,
} from "./api";
import { formatCents, formatDay, formatInvoiceHours, formatRange, formatSeconds } from "./format";
import { label } from "./labels";
import { EntryModal } from "./Log";
import { Field, Modal } from "./Modal";
import { useNav } from "./nav";

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
                      <span className="who">{i.clientName}</span>
                      <span className="note">{formatRange(i.period.start, i.period.end)}</span>
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
    listClients().then((list) => {
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
                  {c.name}
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

export function DraftEditor({ id, version, onChange, onDeleted }: { id: number; version: number; onChange: () => void; onDeleted: () => void }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvoice(id).then(setInvoice);
  }, [id, version]);

  if (!invoice) return null;
  const fail = (err: unknown) => setError(toCoreError(err).message);
  const update = (action: Promise<Invoice>) =>
    action.then((next) => {
      setInvoice(next);
      setError(null);
      onChange();
    }, fail);

  return (
    <>
      <h1>
        {label.invoiceState[invoice.state]} {label.invoice} · {invoice.clientName}
      </h1>
      <p>{formatRange(invoice.period.start, invoice.period.end)}</p>
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
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={invoice.timesheet} onChange={(e) => update(setInvoiceTimesheet(id, e.target.checked))} /> Timesheet page
        </label>
        <button className="ghost" onClick={() => setDeleting(true)}>
          Delete
        </button>
      </div>
      {invoice.newInPeriod > 0 && (
        <p className="hint">
          {invoice.newInPeriod} new uninvoiced {invoice.newInPeriod === 1 ? "entry" : "entries"} in this period
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

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
      {deleting && (
        <Modal title={`Delete ${label.invoice}?`} onClose={() => setDeleting(false)}>
          <p>Its time entries go back to {label.uninvoiced}.</p>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                deleteInvoice(id).then(onDeleted, (err) => {
                  setDeleting(false);
                  fail(err);
                })
              }
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
