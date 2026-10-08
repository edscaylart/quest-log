import { Modal } from "@/components/ui/Modal";
import { deleteClient } from "@/integrations/tauri/commands";
import type { Client, ClientDeletion } from "@/lib/clients/types";
import { formatHours } from "@/lib/format";
import { label } from "@/lib/labels";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeleteClientModal({
  client,
  deletion,
  onClose,
  onDeleted,
  onError,
}: {
  client: Client;
  deletion: ClientDeletion;
  onClose: () => void;
  onDeleted: () => void;
  onError: (err: unknown) => void;
}) {
  return (
    <Modal title={`Delete ${label.client}?`} onClose={onClose}>
      <p>
        {client.name}: {count(deletion.projects, label.project, label.projects)}, {count(deletion.entries, "time entry", "time entries")} and{" "}
        {formatHours(deletion.seconds)} hours go with it. This can't be undone.
      </p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => deleteClient(client.id).then(onDeleted, onError)}>
          Delete
        </button>
      </div>
    </Modal>
  );
}
