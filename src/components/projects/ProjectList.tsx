import { useState } from "react";
import { useNav } from "@/hooks/useNav";
import { formatCents } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Project } from "@/lib/projects/types";

/** A Client's Projects, Active or Complete; `onNew` null hides the new button. */
export function ProjectList({ projects, onNew }: { projects: Project[]; onNew: (() => void) | null }) {
  const [showComplete, setShowComplete] = useState(false);
  const { push } = useNav();
  const shown = projects.filter((p) => p.complete === showComplete);

  return (
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
        {onNew && (
          <button className="primary" onClick={onNew}>
            + New {label.project}
          </button>
        )}
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
  );
}
