import { clientAndProject, formatDay, formatSeconds } from "@/lib/format";
import { label } from "@/lib/labels";
import { byDay } from "@/lib/time-entries/byDay";
import type { TimeEntry } from "@/lib/time-entries/types";

/** Entries grouped under a heading per day, each with its day's total. */
export function DayList({
  entries,
  onEdit,
  onResume,
}: {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onResume: (entry: TimeEntry) => void;
}) {
  return byDay(entries).map(([date, dayEntries]) => (
    <section key={date} className="day" aria-label={formatDay(date)}>
      <h2>
        <span>{formatDay(date)}</span>
        <span className="num">{formatSeconds(dayEntries.reduce((sum, e) => sum + e.seconds, 0))}</span>
      </h2>
      <ul className="rows">
        {dayEntries.map((e) => (
          <li key={e.id} className="row entry">
            <button onClick={() => onEdit(e)}>
              <span className="who">{clientAndProject(e)}</span>
              <span className="note">{e.note}</span>
              <span className="num">{formatSeconds(e.seconds)}</span>
            </button>
            {e.locked && (
              <span className="lock" role="img" aria-label="Locked" title={`On a ${label.invoiceState.sent} ${label.invoice}`}>
                🔒
              </span>
            )}
            <button className="ghost icon" aria-label="Resume" onClick={() => onResume(e)}>
              ▶
            </button>
          </li>
        ))}
      </ul>
    </section>
  ));
}
