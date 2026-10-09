import { useState } from "react";
import { ClientDetails } from "@/components/clients/ClientDetails";
import { DeleteClientModal } from "@/components/clients/DeleteClientModal";
import { EditClientModal } from "@/components/clients/EditClientModal";
import { ProjectList } from "@/components/projects/ProjectList";
import { ProjectModal } from "@/components/projects/ProjectModal";
import { RecentEntries } from "@/components/time-entries/RecentEntries";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { useLoad } from "@/hooks/useLoad";
import { clientDeletion, getClient, listProjects, listTimeEntries, setClientArchived } from "@/integrations/tauri/commands";
import type { ClientDeletion } from "@/lib/clients/types";
import { toCoreError } from "@/lib/errors";

const RECENT = 10;

export function Client({ id, version, onChange, onDeleted }: { id: number; version: number; onChange: () => void; onDeleted: () => void }) {
  const client = useLoad(() => getClient(id), [id, version]).data;
  const projects = useLoad(() => listProjects(id), [id, version]).data ?? [];
  const entries = useLoad(() => listTimeEntries(id).then((list) => list.slice(0, RECENT)), [id, version]).data ?? [];
  const [editing, setEditing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [deleting, setDeleting] = useState<ClientDeletion | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!client) return null;
  const fail = (err: unknown) => setError(toCoreError(err).message);
  const toggleArchived = () => setClientArchived(id, !client.archived).then(onChange, fail);
  const askDelete = () => clientDeletion(id).then(setDeleting, fail);

  return (
    <>
      <h1>{client.name}</h1>
      <ClientDetails client={client} onEdit={() => setEditing(true)} onToggleArchived={toggleArchived} onDelete={askDelete} />
      <ErrorLine error={error} />

      <ProjectList projects={projects} onNew={client.archived ? null : () => setCreatingProject(true)} />

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
      {deleting && (
        <DeleteClientModal
          client={client}
          deletion={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={onDeleted}
          onError={(err) => {
            setDeleting(null);
            fail(err);
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
