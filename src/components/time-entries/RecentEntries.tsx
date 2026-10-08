import { useState } from "react";
import { TimeEntryModal } from "@/components/time-entries/TimeEntryModal";
import { formatDay, formatSeconds } from "@/lib/format";
import type { TimeEntry } from "@/lib/time-entries/types";

/** A short list of entries (newest first) that open in the edit modal. */
export function RecentEntries({ entries, onChange }: { entries: TimeEntry[]; onChange: () => void }) {
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  if (!entries.length) return <p className="hint">No time logged yet.</p>;
  return (
    <>
      <ul className="rows">
        {entries.map((e) => (
          <li key={e.id} className="row entry">
            <button onClick={() => setEditing(e)}>
              <span className="who">{formatDay(e.date)}</span>
              <span className="note">{[e.projectName, e.note].filter(Boolean).join(" · ")}</span>
              <span className="num">{formatSeconds(e.seconds)}</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <TimeEntryModal
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </>
  );
}
