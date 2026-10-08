import type { Client } from "@/lib/clients/types";
import { formatCents } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Project } from "@/lib/projects/types";

export function ProjectDetails({
  project,
  client,
  onEdit,
  onToggleComplete,
  onDelete,
}: {
  project: Project;
  client: Client;
  onEdit: () => void;
  onToggleComplete: () => void;
  onDelete: () => void;
}) {
  return (
    <>
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
        <button className="ghost" aria-label={`Edit ${label.project}`} onClick={onEdit}>
          Edit
        </button>
        <button className="ghost" onClick={onToggleComplete}>
          {project.complete ? "Reopen" : `Mark ${label.complete}`}
        </button>
        <button className="ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  );
}
