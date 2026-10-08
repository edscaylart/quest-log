import { useEffect, useState, type FormEvent } from "react";
import { RecentEntries } from "@/components/time-entries/RecentEntries";
import { RepriceConfirm, reprices } from "./Modal";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  createProject,
  deleteProject,
  getClient,
  getProject,
  listTimeEntries,
  previewProjectRate,
  setProjectComplete,
  updateProject,
} from "@/integrations/tauri/commands";
import type { Client, Repricing } from "@/lib/clients/types";
import { toCoreError, type CoreError } from "@/lib/errors";
import { formatCents, formatHours } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Project } from "@/lib/projects/types";
import type { TimeEntry } from "@/lib/time-entries/types";

export function ProjectDetail({
  id,
  version,
  onChange,
  onDeleted,
}: {
  id: number;
  version: number;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProject(id).then(async (p) => {
      setProject(p);
      setClient(await getClient(p.clientId));
      // ponytail: filtered here; a project filter in core when lists get long.
      setEntries((await listTimeEntries(p.clientId)).filter((e) => e.projectId === id));
    });
  }, [id, version]);

  if (!project || !client) return null;
  const fail = (err: unknown) => setError(toCoreError(err).message);
  const toggle = () => setProjectComplete(id, !project.complete).then(onChange, fail);

  return (
    <>
      <h1>{project.name}</h1>
      <dl className="details">
        <dt>{label.client}</dt>
        <dd>{client.name}</dd>
        <dt>{label.rate}</dt>
        <dd className="num">
          {formatCents(project.effectiveRateCents)} {label.rate}
          {project.rateCents == null && ` (${label.client} rate)`}
        </dd>
        <dt>Status</dt>
        <dd>{project.complete ? label.complete : "Active"}</dd>
      </dl>
      <div className="toolbar">
        <button className="ghost" aria-label={`Edit ${label.project}`} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="ghost" onClick={toggle}>
          {project.complete ? "Reopen" : `Mark ${label.complete}`}
        </button>
        <button className="ghost" onClick={() => setDeleting(true)}>
          Delete
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="day" aria-label="Time entries">
        <h2>Time entries</h2>
        <RecentEntries entries={entries} onChange={onChange} />
      </section>

      {editing && (
        <ProjectModal
          clientId={client.id}
          project={project}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
      {deleting && (
        <Modal title={`Delete ${label.project}?`} onClose={() => setDeleting(false)}>
          <p>
            {project.name}
            {entries.length > 0 &&
              `: ${entries.length} time ${entries.length === 1 ? "entry" : "entries"} and ${formatHours(entries.reduce((sum, e) => sum + e.seconds, 0))} hours go with it`}
            . This can't be undone.
          </p>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                deleteProject(id).then(onDeleted, (err) => {
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

/** New (`project` null) or edit; a rate edit confirms its repricing first. */
export function ProjectModal({
  clientId,
  project,
  onClose,
  onSaved,
}: {
  clientId: number;
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialRate = project?.rateCents == null ? "" : (project.rateCents / 100).toFixed(2);
  const [name, setName] = useState(project?.name ?? "");
  const [rate, setRate] = useState(initialRate);
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Repricing | null>(null);
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
      await (project ? updateProject(project.id, { name, rate }) : createProject(clientId, { name, rate }));
      onSaved();
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!project || rate === initialRate) return save();
    run(async () => {
      const repricing = await previewProjectRate(project.id, rate);
      if (reprices(repricing)) setConfirming(repricing);
      else await save();
    });
  }

  if (confirming) return <RepriceConfirm repricing={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={save} />;

  return (
    <Modal title={project ? `Edit ${label.project}` : `New ${label.project}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="project-name" label="Name" error={fieldError("name")}>
          <input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!fieldError("name")} />
        </Field>
        <Field id="project-rate" label={label.rate} error={fieldError("rate")}>
          <input
            id="project-rate"
            inputMode="decimal"
            placeholder={`${label.client} rate`}
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
            {project ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
