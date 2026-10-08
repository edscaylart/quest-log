import { useEffect, useId, useState, type ReactNode } from "react";
import { listProjects, type CoreError, type Project, type Repricing } from "./api";
import { formatCents, formatHours } from "./format";
import { label } from "./labels";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop">
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ id, label, error, children }: { id: string; label: string; error: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Optional project of `clientId`: its active ones, plus `keep` (an entry's
 * current project) even if complete. Changing the client resets it in the caller.
 */
export function ProjectField({
  id,
  clientId,
  projectId,
  setProjectId,
  keep = null,
  error,
}: {
  id: string;
  clientId: number;
  projectId: number | null;
  setProjectId: (id: number | null) => void;
  keep?: number | null;
  error: CoreError | null;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    if (clientId) listProjects(clientId).then(setProjects);
  }, [clientId]);

  const message = error?.kind === "invalid" && error.field === "project" ? error.message : null;
  return (
    <Field id={id} label={label.project} error={message}>
      <select
        id={id}
        value={projectId ?? ""}
        onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        aria-invalid={!!message}
      >
        <option value="">{label.noProject}</option>
        {projects
          .filter((p) => !p.complete || p.id === keep)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

/** Whether a rate edit needs the repricing confirm. */
export const reprices = (r: Repricing) => r.seconds > 0 && r.oldCents !== r.newCents;

export function RepriceConfirm({ repricing, busy, onCancel, onConfirm }: { repricing: Repricing; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Change rate?" onClose={onCancel}>
      <p>
        {formatHours(repricing.seconds)} uninvoiced hours reprice: {formatCents(repricing.oldCents)} → {formatCents(repricing.newCents)}
      </p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
          Reprice
        </button>
      </div>
    </Modal>
  );
}
