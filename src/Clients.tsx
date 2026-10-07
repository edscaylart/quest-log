import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient, isCoreError, listClients, type Client, type CoreError } from "./api";
import { formatCents } from "./format";
import { label } from "./labels";
import { Modal } from "./Modal";

export function Clients() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => listClients().then(setClients);
  useEffect(() => {
    reload();
  }, []);

  return (
    <>
      <h1>{label.clients}</h1>
      <button className="primary" onClick={() => setCreating(true)}>
        + New {label.client}
      </button>
      {clients?.length === 0 && <p className="hint">No {label.clients} yet.</p>}
      <ul className="rows">
        {clients?.map((c) => (
          <li key={c.id} className="row">
            <span>{c.name}</span>
            <span className="num">
              {formatCents(c.rateCents)} {label.rate}
            </span>
          </li>
        ))}
      </ul>
      {creating && (
        <NewClientModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createClient({ name, rate });
      onCreated();
    } catch (err) {
      // Anything that isn't a core error (e.g. IPC failure) still shows its message.
      setError(isCoreError(err) ? err : { kind: "database", message: String(err) });
      setBusy(false);
    }
  }

  return (
    <Modal title={`New ${label.client}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="client-name" label="Name" error={fieldError("name")}>
          <input id="client-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!fieldError("name")} />
        </Field>
        <Field id="client-rate" label={label.rate} error={fieldError("rate")}>
          <input
            id="client-rate"
            inputMode="decimal"
            placeholder="85.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={!!fieldError("rate")}
          />
        </Field>
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
