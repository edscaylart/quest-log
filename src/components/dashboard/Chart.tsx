import { useState } from "react";
import type { Dashboard } from "@/lib/dashboard/types";
import { formatDay, formatMonthDay, formatSeconds } from "@/lib/format";

/** One bar per bucket; hover, focus or tap shows its value. */
export function Chart({ data }: { data: Dashboard }) {
  const [shown, setShown] = useState<number | null>(null);
  const max = Math.max(0, ...data.buckets.map((b) => b.seconds));
  const name = (start: string) => (data.weekly ? `Week of ${formatMonthDay(start)}` : formatDay(start));
  const current = shown == null ? null : data.buckets[shown];

  return (
    <figure className="chart" role="group" aria-label={data.weekly ? "Hours per week" : "Hours per day"}>
      <p className="hint" aria-live="polite">
        {current ? `${name(current.start)} · ${formatSeconds(current.seconds)}` : " "}
      </p>
      <div className="bars" onMouseLeave={() => setShown(null)}>
        {data.buckets.map((b, i) => (
          <button
            key={b.start}
            type="button"
            aria-label={`${name(b.start)}: ${formatSeconds(b.seconds)}`}
            aria-pressed={shown === i}
            onMouseEnter={() => setShown(i)}
            onFocus={() => setShown(i)}
            onClick={() => setShown(i)}
          >
            <span style={{ height: `${max ? (b.seconds / max) * 100 : 0}%` }} />
          </button>
        ))}
      </div>
    </figure>
  );
}
