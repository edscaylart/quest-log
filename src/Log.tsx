import { useEffect, useState, type FormEvent } from "react";
import {
  createTimeEntry,
  deleteTimeEntry,
  lastUsedClient,
  listClients,
  listTimeEntries,
  toCoreError,
  updateTimeEntry,
  type Client,
  type CoreError,
  type Span,
  type TimeEntry,
} from "./api";
import { formatDay, formatSeconds, localDate, localTime } from "./format";
import { label } from "./labels";
import { Field, Modal } from "./Modal";

/** `creating` lives in App so ⌘N can open the new-entry modal from any tab. */
export function Log({ creating, setCreating }: { creating: boolean; setCreating: (open: boolean) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const reload = () => listTimeEntries(clientId).then(setEntries);
  useEffect(() => {
    listClients().then(setClients);
  }, []);
  useEffect(() => {
    reload();
  }, [clientId]);

  const close = () => {
    setCreating(false);
    setEditing(null);
  };
  const saved = () => {
    close();
    reload();
  };

  return (
    <>
      <h1>Log</h1>
      <div className="toolbar">
        <select
          aria-label={`${label.client} filter`}
          value={clientId ?? ""}
          onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{label.allClients}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="primary" aria-label="New time entry" onClick={() => setCreating(true)}>
          +
        </button>
      </div>
      {entries?.length === 0 && <p className="hint">No time logged yet.</p>}
      {byDay(entries ?? []).map(([date, dayEntries]) => (
        <section key={date} className="day" aria-label={formatDay(date)}>
          <h2>
            <span>{formatDay(date)}</span>
            <span className="num">{formatSeconds(dayEntries.reduce((sum, e) => sum + e.seconds, 0))}</span>
          </h2>
          <ul className="rows">
            {dayEntries.map((e) => (
              <li key={e.id} className="row entry">
                <button onClick={() => setEditing(e)}>
                  <span className="who">{e.clientName}</span>
                  <span className="note">{e.note}</span>
                  <span className="num">{formatSeconds(e.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {(creating || editing) && <EntryModal key={editing?.id ?? "new"} entry={editing} onClose={close} onSaved={saved} />}
    </>
  );
}

/** Entries arrive newest first; keep that order within and across days. */
function byDay(entries: TimeEntry[]) {
  const days = new Map<string, TimeEntry[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  return [...days];
}

/** Like formatSeconds, but keeps leftover seconds so an untouched edit saves the same duration. */
const editableDuration = (s: number) => (s % 60 ? `${formatSeconds(s)}:${String(s % 60).padStart(2, "0")}` : formatSeconds(s));

function EntryModal({ entry, onClose, onSaved }: { entry: TimeEntry | null; onClose: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState(entry?.clientId ?? 0);
  const [date, setDate] = useState(entry?.date ?? localDate(new Date()));
  const [mode, setMode] = useState<Span["mode"]>(entry?.startedAt != null ? "range" : "duration");
  const [duration, setDuration] = useState(entry && entry.startedAt == null ? editableDuration(entry.seconds) : "");
  const [start, setStart] = useState(entry?.startedAt != null ? localTime(entry.startedAt) : "");
  const [end, setEnd] = useState(entry?.endedAt != null ? localTime(entry.endedAt) : "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    Promise.all([listClients(), entry ? null : lastUsedClient()]).then(([list, last]) => {
      setClients(list);
      if (!entry) setClientId(list.find((c) => c.id === last)?.id ?? list[0]?.id ?? 0);
    });
  }, [entry]);

  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onSaved();
    } catch (err) {
      setError(toCoreError(err));
      setConfirmingDelete(false);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const span: Span = mode === "duration" ? { mode, duration } : { mode, start, end };
    const input = { clientId, date, span, note };
    run(() => (entry ? updateTimeEntry(entry.id, input) : createTimeEntry(input)));
  }

  if (entry && confirmingDelete) {
    return (
      <Modal title="Delete time entry?" onClose={() => setConfirmingDelete(false)}>
        <p>
          {entry.clientName}, {formatDay(entry.date)}, {formatSeconds(entry.seconds)}. This can't be undone.
        </p>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => run(() => deleteTimeEntry(entry.id))}>
            Delete
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={entry ? "Edit time entry" : "New time entry"} onClose={onClose}>
      {clients?.length === 0 ? (
        <>
          <p className="hint">Add a {label.client} first.</p>
          <div className="actions">
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field id="entry-client" label={label.client} error={fieldError("client")}>
            <select id="entry-client" value={clientId} onChange={(e) => setClientId(Number(e.target.value))} aria-invalid={!!fieldError("client")}>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="entry-date" label="Date" error={fieldError("date")}>
            <input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!fieldError("date")} />
          </Field>
          <div className="segmented" role="group" aria-label="Entry mode">
            <button type="button" aria-pressed={mode === "duration"} onClick={() => setMode("duration")}>
              Duration
            </button>
            <button type="button" aria-pressed={mode === "range"} onClick={() => setMode("range")}>
              Start–End
            </button>
          </div>
          {mode === "duration" ? (
            <Field id="entry-duration" label="Duration" error={fieldError("duration")}>
              <input
                id="entry-duration"
                inputMode="decimal"
                placeholder="1:30"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                aria-invalid={!!fieldError("duration")}
              />
            </Field>
          ) : (
            <div className="pair">
              <Field id="entry-start" label="Start" error={fieldError("start")}>
                <input id="entry-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!fieldError("start")} />
              </Field>
              <Field id="entry-end" label="End" error={fieldError("end")}>
                <input id="entry-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!fieldError("end")} />
              </Field>
            </div>
          )}
          <Field id="entry-note" label="Note" error={fieldError("note")}>
            <input id="entry-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
          <div className="actions">
            {entry && (
              <button type="button" className="ghost" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            )}
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !clients}>
              Save
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
