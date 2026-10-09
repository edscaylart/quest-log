import { useState } from "react";
import { DayList } from "@/components/time-entries/DayList";
import { LogToolbar } from "@/components/time-entries/LogToolbar";
import { TimeEntryModal } from "@/components/time-entries/TimeEntryModal";
import { useClients } from "@/hooks/clients/useClients";
import { useLoad } from "@/hooks/useLoad";
import { listTimeEntries } from "@/integrations/tauri/commands";
import type { TimeEntry } from "@/lib/time-entries/types";

/**
 * `creating` lives in App so ⌘N can open the new-entry modal from any tab.
 * `version` changes when entries changed elsewhere (e.g. a Timer stopped);
 * `onChange` reports a saved or deleted entry, which bumps it.
 */
export function Log({
  creating,
  setCreating,
  version,
  onChange,
  onResume,
}: {
  creating: boolean;
  setCreating: (open: boolean) => void;
  version: number;
  onChange: () => void;
  onResume: (entry: TimeEntry) => void;
}) {
  const [clientId, setClientId] = useState<number | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const clients = useClients() ?? [];
  const entries = useLoad(() => listTimeEntries(clientId), [clientId, version]).data;

  const close = () => {
    setCreating(false);
    setEditing(null);
  };
  const saved = () => {
    close();
    onChange();
  };

  return (
    <>
      <h1>Log</h1>
      <LogToolbar clients={clients} clientId={clientId} setClientId={setClientId} onNew={() => setCreating(true)} />
      {entries?.length === 0 && <p className="hint">No time logged yet.</p>}
      <DayList entries={entries ?? []} onEdit={setEditing} onResume={onResume} />
      {(creating || editing) && <TimeEntryModal key={editing?.id ?? "new"} entry={editing} onClose={close} onSaved={saved} />}
    </>
  );
}
