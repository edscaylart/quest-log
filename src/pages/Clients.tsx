import { useEffect, useState } from "react";
import { ClientList } from "@/components/clients/ClientList";
import { ClientsToolbar } from "@/components/clients/ClientsToolbar";
import { NewClientModal } from "@/components/clients/NewClientModal";
import { listClients } from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";
import { label } from "@/lib/labels";

export function Clients({ version, onChange }: { version: number; onChange: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const shown = clients?.filter((c) => c.archived === showArchived);

  const reload = () => listClients().then(setClients);
  useEffect(() => {
    reload();
  }, [version]);

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
            reload();
            onChange();
          }}
        />
      )}
    </>
  );
}
