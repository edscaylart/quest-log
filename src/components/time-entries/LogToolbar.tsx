import type { Client } from "@/lib/clients/types";
import { label } from "@/lib/labels";

/** The Log's Client filter (archived ones grouped last) and its new-entry button. */
export function LogToolbar({
  clients,
  clientId,
  setClientId,
  onNew,
}: {
  clients: Client[];
  clientId: number | null;
  setClientId: (id: number | null) => void;
  onNew: () => void;
}) {
  return (
    <div className="toolbar">
      <select
        aria-label={`${label.client} filter`}
        value={clientId ?? ""}
        onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{label.allClients}</option>
        {clients
          .filter((c) => !c.archived)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        {clients.some((c) => c.archived) && (
          <optgroup label={label.archived}>
            {clients
              .filter((c) => c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        )}
      </select>
      <button className="primary" aria-label="New time entry" onClick={onNew}>
        +
      </button>
    </div>
  );
}
