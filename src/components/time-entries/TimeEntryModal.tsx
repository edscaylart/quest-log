import { useState, type FormEvent } from "react";
import { ProjectField } from "@/components/projects/ProjectField";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useClients } from "@/hooks/clients/useClients";
import { useFormAction } from "@/hooks/useFormAction";
import { useLoad } from "@/hooks/useLoad";
import {
  createTimeEntry,
  deleteTimeEntry,
  discardTimer,
  finishTimer,
  lastUsed,
  updateTimeEntry,
} from "@/integrations/tauri/commands";
import { clientChange } from "@/lib/clients/clientChange";
import { clientAndProject, formatDay, formatSeconds, localDate, localTime } from "@/lib/format";
import { label } from "@/lib/labels";
import { editableDuration } from "@/lib/time-entries/editableDuration";
import type { Span, TimeEntry } from "@/lib/time-entries/types";
import type { Overlong } from "@/lib/timer/types";

/** New (neither prop), edit (`entry`; read-only if locked), or fix a Timer that ran over 24 hours (`overlong`). */
export function TimeEntryModal({
  entry,
  overlong,
  onClose,
  onSaved,
}: {
  entry: TimeEntry | null;
  overlong?: Overlong;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = entry ?? overlong;
  const locked = !!entry?.locked;
  const [clientId, setClientId] = useState(initial?.clientId ?? 0);
  const [projectId, setProjectId] = useState(initial?.projectId ?? null);
  const [date, setDate] = useState(initial?.date ?? localDate(new Date()));
  const [mode, setMode] = useState<Span["mode"]>(entry?.startedAt != null ? "range" : "duration");
  const [duration, setDuration] = useState(initial && entry?.startedAt == null ? editableDuration(initial.seconds) : "");
  const [start, setStart] = useState(entry?.startedAt != null ? localTime(entry.startedAt) : "");
  const [end, setEnd] = useState(entry?.endedAt != null ? localTime(entry.endedAt) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const { error, busy, run: attempt, fieldError } = useFormAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Retired clients take no new entries; an entry keeps its own.
  const { clients: listed, error: clientsError } = useClients((c) => !c.archived || c.id === initial?.clientId, [initial]);
  // Boxed so a null lastUsed still reads as loaded.
  const { data: lastPick, error: lastUsedError } = useLoad(() => (initial ? null : lastUsed().then((used) => ({ used }))), [initial]);
  // A new entry seeds its form once, before its Clients show. A failed lastUsed
  // is silent on purpose: it only picks defaults, so the form seeds without it.
  const [seeded, setSeeded] = useState(!!initial);
  if (!seeded && listed && (lastPick || lastUsedError)) {
    const used = lastPick?.used;
    const known = listed.some((c) => c.id === used?.clientId);
    setSeeded(true);
    setClientId(known ? used!.clientId : (listed[0]?.id ?? 0));
    setProjectId(known ? used!.projectId : null);
  }
  const clients = seeded ? listed : null;

  // A failed delete lands back on the form.
  const run = (action: () => Promise<unknown>) =>
    attempt(async () => {
      await action();
      onSaved();
    }).then((ok) => ok || setConfirmingDelete(false));

  function submit(e: FormEvent) {
    e.preventDefault();
    const span: Span = mode === "duration" ? { mode, duration } : { mode, start, end };
    const input = { clientId, projectId, date, span, note };
    run(() => (overlong ? finishTimer(input) : entry ? updateTimeEntry(entry.id, input) : createTimeEntry(input)));
  }

  if (entry && confirmingDelete) {
    return (
      <Modal title="Delete time entry?" onClose={() => setConfirmingDelete(false)}>
        <p>
          {clientAndProject(entry)}, {formatDay(entry.date)}, {formatSeconds(entry.seconds)}. This can't be undone.
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
    <Modal title={overlong ? "Fix Timer entry" : locked ? "Time entry" : entry ? "Edit time entry" : "New time entry"} onClose={onClose}>
      {overlong && <p className="hint">The Timer ran over 24 hours. Fix the duration to save it, or discard it.</p>}
      {locked && (
        <p className="hint">
          🔒 On a {label.invoiceState.sent} {label.invoice}. Unseal it to change this entry.
        </p>
      )}
      <ErrorLine error={clientsError} />
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
          <fieldset className="plain" disabled={locked}>
          <Field id="entry-client" label={label.client} error={fieldError("client")}>
            <select
              id="entry-client"
              value={clientId}
              onChange={clientChange(setClientId, setProjectId)}
              aria-invalid={!!fieldError("client")}
            >
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <ProjectField
            id="entry-project"
            clientId={clientId}
            projectId={projectId}
            setProjectId={setProjectId}
            keep={initial?.projectId}
            error={fieldError("project")}
          />
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
          </fieldset>
          {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
          <div className="actions">
            {entry && !locked && (
              <button type="button" className="ghost" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            )}
            {overlong && (
              <button type="button" className="ghost" disabled={busy} onClick={() => run(discardTimer)}>
                Discard
              </button>
            )}
            <button type="button" className="ghost" onClick={onClose}>
              {locked ? "Close" : "Cancel"}
            </button>
            {!locked && (
              <button type="submit" className="primary" disabled={busy || !clients}>
                Save
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
