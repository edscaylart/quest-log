import { useState, type FormEvent } from "react";
import { RepriceConfirm } from "@/components/projects/RepriceConfirm";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { createProject, previewProjectRate, updateProject } from "@/integrations/tauri/commands";
import type { Repricing } from "@/lib/clients/types";
import { toCoreError, type CoreError } from "@/lib/errors";
import { label } from "@/lib/labels";
import { reprices } from "@/lib/projects/reprices";
import type { Project } from "@/lib/projects/types";

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
