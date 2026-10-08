import { presets, type Saved } from "@/lib/dashboard/savedPeriod";
import type { Period } from "@/lib/dashboard/types";
import { formatRange } from "@/lib/format";

/** The Period presets and the previous/next stepper; `period` is the one last shown, if any. */
export function PeriodControls({
  saved: { preset, range },
  period,
  offset,
  setOffset,
  choose,
}: {
  saved: Saved;
  period: Period | undefined;
  offset: number;
  setOffset: (offset: number) => void;
  choose: (next: Saved) => void;
}) {
  // A custom date edit keeps the other end as shown and restarts stepping from there.
  const edit = (side: "start" | "end") => (e: { target: { value: string } }) => {
    if (e.target.value && period) choose({ preset: "custom", range: { ...period, [side]: e.target.value } });
  };

  return (
    <>
      <div className="segmented" role="group" aria-label="Period">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => choose({ preset: p.id, range: p.id === "custom" ? (period ?? range) : null })}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div className="toolbar stepper">
        <button className="ghost" aria-label="Previous period" onClick={() => setOffset(offset - 1)}>
          ◀
        </button>
        {preset === "custom" && period ? (
          <div className="pair">
            {/* Uncommitted until a full date; remounts when the shown days change. */}
            <input key={`s${period.start}`} type="date" aria-label="From" defaultValue={period.start} onChange={edit("start")} />
            <input key={`e${period.end}`} type="date" aria-label="To" defaultValue={period.end} onChange={edit("end")} />
          </div>
        ) : (
          <span className="range">{period && formatRange(period.start, period.end)}</span>
        )}
        <button className="ghost" aria-label="Next period" onClick={() => setOffset(offset + 1)}>
          ▶
        </button>
      </div>
    </>
  );
}
