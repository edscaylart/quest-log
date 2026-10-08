import { useEffect, useState, type FormEvent } from "react";
import {
  createClient,
  getClient,
  listClients,
  listProjects,
  listTimeEntries,
  previewClientRate,
  toCoreError,
  updateClient,
  type Client,
  type ClientEdit,
  type CoreError,
  type Project,
  type Repricing,
  type TimeEntry,
} from "./api";
import { formatCents } from "./format";
import { label } from "./labels";
import { RecentEntries } from "./Log";
import { Field, Modal, RepriceConfirm, reprices } from "./Modal";
import { useNav } from "./nav";
import { ProjectModal } from "./Projects";

const RECENT = 10;

export function Clients({ version, onChange }: { version: number; onChange: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { push } = useNav();

  const reload = () => listClients().then(setClients);
  useEffect(() => {
    reload();
  }, [version]);

  return (
    <>
      <h1>{label.clients}</h1>
      <button className="primary" onClick={() => setCreating(true)}>
        + New {label.client}
      </button>
      {clients?.length === 0 && <p className="hint">No {label.clients} yet.</p>}
      <ul className="rows">
        {clients?.map((c) => (
          <li key={c.id} className="row entry">
            <button onClick={() => push({ kind: "client", id: c.id })}>
              <span className="note">{c.name}</span>
              <span className="num">
                {formatCents(c.rateCents)} {label.rate}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {creating && (
        <NewClientModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
            onChange();
          }}
        />
      )}
    </>
  );
}

export function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
      setError(toCoreError(err));
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

export function ClientDetail({ id, version, onChange }: { id: number; version: number; onChange: () => void }) {
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [showComplete, setShowComplete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const { push } = useNav();

  useEffect(() => {
    getClient(id).then(setClient);
    listProjects(id).then(setProjects);
    listTimeEntries(id).then((list) => setEntries(list.slice(0, RECENT)));
  }, [id, version]);

  if (!client) return null;
  const shown = projects.filter((p) => p.complete === showComplete);

  return (
    <>
      <h1>{client.name}</h1>
      <dl className="details">
        <dt>{label.rate}</dt>
        <dd className="num">
          {formatCents(client.rateCents)} {label.rate}
        </dd>
        <dt>Billing name</dt>
        <dd>{client.billingName ?? client.name}</dd>
        <dt>Address</dt>
        <dd className="multiline">{client.address ?? "—"}</dd>
        <dt>Email</dt>
        <dd>{client.email ?? "—"}</dd>
        <dt>Terms</dt>
        <dd>{client.netDays == null ? "Default" : `Net ${client.netDays}`}</dd>
      </dl>
      <button className="ghost" aria-label={`Edit ${label.client}`} onClick={() => setEditing(true)}>
        Edit
      </button>

      <section className="day" aria-label={label.projects}>
        <h2>{label.projects}</h2>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label={`${label.projects} shown`}>
            <button type="button" aria-pressed={!showComplete} onClick={() => setShowComplete(false)}>
              Active
            </button>
            <button type="button" aria-pressed={showComplete} onClick={() => setShowComplete(true)}>
              Complete
            </button>
          </div>
          <button className="primary" onClick={() => setCreatingProject(true)}>
            + New {label.project}
          </button>
        </div>
        {shown.length === 0 && <p className="hint">No {showComplete ? "complete" : "active"} {label.projects}.</p>}
        <ul className="rows">
          {shown.map((p) => (
            <li key={p.id} className="row entry">
              <button onClick={() => push({ kind: "project", id: p.id })}>
                <span className="note">{p.name}</span>
                <span className="num">{p.rateCents == null ? `${label.client} rate` : `${formatCents(p.rateCents)} ${label.rate}`}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="day" aria-label="Recent time entries">
        <h2>Recent</h2>
        <RecentEntries entries={entries} onChange={onChange} />
      </section>

      {editing && (
        <EditClientModal
          client={client}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
      {creatingProject && (
        <ProjectModal
          clientId={client.id}
          project={null}
          onClose={() => setCreatingProject(false)}
          onSaved={() => {
            setCreatingProject(false);
            onChange();
          }}
        />
      )}
    </>
  );
}

function EditClientModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const initialRate = (client.rateCents / 100).toFixed(2);
  const [form, setForm] = useState<ClientEdit>({
    name: client.name,
    rate: initialRate,
    billingName: client.billingName ?? "",
    address: client.address ?? "",
    email: client.email ?? "",
    netDays: client.netDays?.toString() ?? "",
  });
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Repricing | null>(null);
  const set = (field: keyof ClientEdit) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });
  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(toCoreError(err));
      setConfirming(null);
    }
    setBusy(false);
  }

  const save = () =>
    run(async () => {
      await updateClient(client.id, form);
      onSaved();
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.rate === initialRate) return save();
    run(async () => {
      const repricing = await previewClientRate(client.id, form.rate);
      if (reprices(repricing)) setConfirming(repricing);
      else await save();
    });
  }

  if (confirming) return <RepriceConfirm repricing={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={save} />;

  const text = (field: keyof ClientEdit, title: string, extra: object = {}) => (
    <Field id={`client-${field}`} label={title} error={fieldError(field)}>
      <input id={`client-${field}`} value={form[field]} onChange={set(field)} aria-invalid={!!fieldError(field)} {...extra} />
    </Field>
  );

  return (
    <Modal title={`Edit ${label.client}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {text("name", "Name")}
        {text("rate", label.rate, { inputMode: "decimal" })}
        {text("billingName", "Billing name", { placeholder: form.name })}
        <Field id="client-address" label="Address" error={fieldError("address")}>
          <textarea id="client-address" rows={3} value={form.address} onChange={set("address")} />
        </Field>
        {text("email", "Email", { type: "email" })}
        {text("netDays", "Net days", { inputMode: "numeric", placeholder: "Default" })}
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
