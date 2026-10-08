import { useEffect, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { listProjects } from "@/integrations/tauri/commands";
import type { Repricing } from "@/lib/clients/types";
import type { CoreError } from "@/lib/errors";
import { formatCents, formatHours } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Project } from "@/lib/projects/types";

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
