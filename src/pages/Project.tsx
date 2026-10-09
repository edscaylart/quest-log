import { useState } from "react";
import { DeleteProjectModal } from "@/components/projects/DeleteProjectModal";
import { ProjectDetails } from "@/components/projects/ProjectDetails";
import { ProjectModal } from "@/components/projects/ProjectModal";
import { RecentEntries } from "@/components/time-entries/RecentEntries";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { useLoad } from "@/hooks/useLoad";
import { getClient, getProject, listTimeEntries, setProjectComplete } from "@/integrations/tauri/commands";
import { toCoreError } from "@/lib/errors";

export function Project({
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
  const project = useLoad(() => getProject(id), [id, version]).data;
  const clientId = project?.clientId;
  const client = useLoad(() => (clientId ? getClient(clientId) : null), [clientId, version]).data;
  const entries =
    useLoad(
      // ponytail: filtered here; a project filter in core when lists get long.
      () => (clientId ? listTimeEntries(clientId).then((all) => all.filter((e) => e.projectId === id)) : null),
      [clientId, id, version],
    ).data ?? [];
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project || !client) return null;
  const fail = (err: unknown) => setError(toCoreError(err).message);
  const toggleComplete = () => setProjectComplete(id, !project.complete).then(onChange, fail);

  return (
    <>
      <h1>{project.name}</h1>
      <ProjectDetails project={project} client={client} onEdit={() => setEditing(true)} onToggleComplete={toggleComplete} onDelete={() => setDeleting(true)} />
      <ErrorLine error={error} />

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
        <DeleteProjectModal
          project={project}
          entries={entries}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
          onError={(err) => {
            setDeleting(false);
            fail(err);
          }}
        />
      )}
    </>
  );
}
