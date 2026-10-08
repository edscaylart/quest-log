import { useEffect, useState, type FormEvent } from "react";
import { ProjectField } from "./Modal";
import { Level } from "./Progress";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { discardTimer, lastUsed, listClients, startTimer, stopTimer, updateTimer } from "@/integrations/tauri/commands";
import { onTrayStart } from "@/integrations/tauri/events";
import type { Client } from "@/lib/clients/types";
import { toCoreError, type CoreError } from "@/lib/errors";
import { clientAndProject, formatClock, localDate, localTime } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Progress } from "@/lib/progress/types";
import type { Stopped, Timer } from "@/lib/timer/types";

const STILL_WORKING_SECONDS = 12 * 3600;

/** Whole seconds since the Timer started, ticking. Wall clock, so sleep doesn't lose time. */
function useElapsed(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * The Timer's controls. `version` changes when clients or the Timer changed
 * elsewhere; `onStopped` gets what a stop or start did to a running Timer.
 */
export function Hud({
  timer,
  progress,
  version,
  error,
  onStopped,
  onChange,
  onError,
  onSettings,
}: {
  timer: Timer | null;
  progress: Progress | null;
  version: number;
  error: string | null;
  onStopped: (outcome: Stopped | null) => void;
  onChange: () => void;
  onError: (err: unknown) => void;
  onSettings: () => void;
}) {
  const [allClients, setClients] = useState<Client[]>([]);
  // Retired clients take no new Timers; a running one keeps its own.
  const clients = allClients.filter((c) => !c.archived);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    listClients().then(setClients);
  }, [version]);

  const stop = () => stopTimer().then(onStopped, onError);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key !== "t") return;
      e.preventDefault();
      if (timer) stop();
      else if (clients.length) setStarting(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [timer, clients.length]);

  // Tray Start with no last-used client lands here.
  useEffect(() => {
    const unlisten = onTrayStart(() => clients.length && setStarting(true));
    return () => void unlisten.then((f) => f());
  }, [clients.length]);

  return (
    <header className="hud">
      {timer ? (
        <Running timer={timer} onEdit={() => setEditing(true)} onStop={stop} onDiscard={() => discardTimer().then(onChange, onError)} />
      ) : (
        <button className="primary" disabled={!clients.length} onClick={() => setStarting(true)}>
          ▶ Start
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="level">
        {progress && <Level progress={progress} />}
        <button className="ghost icon" aria-label="Settings" onClick={onSettings}>
          ⚙
        </button>
      </div>
      {starting && (
        <StartModal
          clients={clients}
          onClose={() => setStarting(false)}
          onStarted={(outcome) => {
            setStarting(false);
            onStopped(outcome);
          }}
        />
      )}
      {editing && timer && (
        <EditModal
          timer={timer}
          clients={allClients.filter((c) => !c.archived || c.id === timer.clientId)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
    </header>
  );
}

function Running({ timer, onEdit, onStop, onDiscard }: { timer: Timer; onEdit: () => void; onStop: () => void; onDiscard: () => void }) {
  const elapsed = useElapsed(timer.startedAt);
  return (
    <div className="timer">
      <button className="ghost" aria-label={`Edit Timer, ${clientAndProject(timer)}`} onClick={onEdit}>
        <span role="timer" className="num">
          {formatClock(elapsed)}
        </span>
        <span className="who">{clientAndProject(timer)}</span>
      </button>
      <button className="primary" onClick={onStop}>
        Stop
      </button>
      <button className="ghost" onClick={onDiscard}>
        Discard
      </button>
      {/* ponytail: a hint only, here and in the tray. No auto-stop. */}
      {elapsed >= STILL_WORKING_SECONDS && <p className="hint">Still working?</p>}
    </div>
  );
}

function StartModal({ clients, onClose, onStarted }: { clients: Client[]; onClose: () => void; onStarted: (outcome: Stopped | null) => void }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? 0);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [error, setError] = useState<CoreError | null>(null);

  useEffect(() => {
    lastUsed().then((last) => {
      if (!last || !clients.some((c) => c.id === last.clientId)) return;
      setClientId(last.clientId);
      setProjectId(last.projectId);
    });
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    startTimer({ clientId, projectId, note: null }).then(onStarted, (err) => setError(toCoreError(err)));
  }

  return (
    <Modal title="Start Timer" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ClientField clients={clients} clientId={clientId} setClientId={setClientId} setProjectId={setProjectId} error={error} />
        <ProjectField id="timer-project" clientId={clientId} projectId={projectId} setProjectId={setProjectId} error={error} />
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Local "YYYY-MM-DDTHH:MM", what `<input type="datetime-local">` holds. */
const localDateTime = (ms: number) => `${localDate(new Date(ms))}T${localTime(ms / 1000)}`;

function EditModal({ timer, clients, onClose, onSaved }: { timer: Timer; clients: Client[]; onClose: () => void; onSaved: () => void }) {
  const initialStart = localDateTime(timer.startedAt);
  const [clientId, setClientId] = useState(timer.clientId);
  const [projectId, setProjectId] = useState(timer.projectId);
  const [note, setNote] = useState(timer.note ?? "");
  const [start, setStart] = useState(initialStart);
  const [error, setError] = useState<CoreError | null>(null);
  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Unchanged start is sent as null so the core keeps its seconds.
    updateTimer({ clientId, projectId, note, start: start === initialStart ? null : start }).then(onSaved, (err) => setError(toCoreError(err)));
  }

  return (
    <Modal title="Edit Timer" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ClientField clients={clients} clientId={clientId} setClientId={setClientId} setProjectId={setProjectId} error={error} />
        <ProjectField
          id="timer-project"
          clientId={clientId}
          projectId={projectId}
          setProjectId={setProjectId}
          keep={timer.projectId}
          error={error}
        />
        <Field id="timer-start" label="Start" error={fieldError("start")}>
          <input id="timer-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!fieldError("start")} />
        </Field>
        <Field id="timer-note" label="Note" error={null}>
          <input id="timer-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientField({
  clients,
  clientId,
  setClientId,
  setProjectId,
  error,
}: {
  clients: Client[];
  clientId: number;
  setClientId: (id: number) => void;
  /** Reset when the client changes: a project belongs to one client. */
  setProjectId: (id: number | null) => void;
  error: CoreError | null;
}) {
  const message = error?.kind === "invalid" && error.field === "client" ? error.message : null;
  return (
    <Field id="timer-client" label={label.client} error={message}>
      <select id="timer-client" value={clientId} 
        onChange={(e) => {
          setClientId(Number(e.target.value));
          setProjectId(null);
        }}
        aria-invalid={!!message}
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
