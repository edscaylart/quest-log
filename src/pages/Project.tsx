import { useEffect, useState } from "react";
import { DeleteProjectModal } from "@/components/projects/DeleteProjectModal";
import { ProjectDetails } from "@/components/projects/ProjectDetails";
import { ProjectModal } from "@/components/projects/ProjectModal";
import { RecentEntries } from "@/components/time-entries/RecentEntries";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { getClient, getProject, listTimeEntries, setProjectComplete } from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";
import { toCoreError } from "@/lib/errors";
import type { Project as ProjectRecord } from "@/lib/projects/types";
import type { TimeEntry } from "@/lib/time-entries/types";

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
  const [project, setProject] = useState<ProjectRecord | null>(null);
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
