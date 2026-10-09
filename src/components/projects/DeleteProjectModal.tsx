import { Modal } from "@/components/ui/Modal";
import { deleteProject } from "@/integrations/tauri/commands";
import { formatHours, pluralise, totalSeconds } from "@/lib/format";
import { label } from "@/lib/labels";
import type { Project } from "@/lib/projects/types";
import type { TimeEntry } from "@/lib/time-entries/types";

export function DeleteProjectModal({
  project,
  entries,
  onClose,
  onDeleted,
  onError,
}: {
  project: Project;
  entries: TimeEntry[];
  onClose: () => void;
  onDeleted: () => void;
  onError: (err: unknown) => void;
}) {
  return (
    <Modal title={`Delete ${label.project}?`} onClose={onClose}>
      <p>
        {project.name}
        {entries.length > 0 &&
          `: ${entries.length} ${pluralise(entries.length, "time entry", "time entries")} and ${formatHours(totalSeconds(entries))} hours go with it`}
        . This can't be undone.
      </p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => deleteProject(project.id).then(onDeleted, onError)}>
          Delete
        </button>
      </div>
    </Modal>
  );
}
