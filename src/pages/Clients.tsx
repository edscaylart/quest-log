import { useState } from "react";
import { ClientList } from "@/components/clients/ClientList";
import { ClientsToolbar } from "@/components/clients/ClientsToolbar";
import { NewClientModal } from "@/components/clients/NewClientModal";
import { useLoad } from "@/hooks/useLoad";
import { listClients } from "@/integrations/tauri/commands";
import { label } from "@/lib/labels";

export function Clients({ version, onChange }: { version: number; onChange: () => void }) {
  const clients = useLoad(listClients, [version]).data;
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const shown = clients?.filter((c) => c.archived === showArchived);

  return (
    <>
      <h1>{label.clients}</h1>
      <ClientsToolbar showArchived={showArchived} setShowArchived={setShowArchived} onNew={() => setCreating(true)} />
      {clients?.length === 0 && <p className="hint">No {label.clients} yet.</p>}
      {!!clients?.length && shown?.length === 0 && <p className="hint">No {showArchived ? label.archived.toLowerCase() : "active"} {label.clients}.</p>}
      <ClientList clients={shown ?? []} />
      {creating && (
        <NewClientModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChange();
          }}
        />
      )}
    </>
  );
}
