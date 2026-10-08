import { label } from "@/lib/labels";
import type { Progress } from "@/lib/progress/types";

/** `Lv N` and the XP bar to the next Level. */
export function Level({ progress }: { progress: Progress }) {
  const { level, xp, levelXp, nextLevelXp } = progress;
  const span = nextLevelXp - levelXp;
  return (
    <>
      <span className="num">
        {label.level} {level}
      </span>
      <span className="xp" role="progressbar" aria-label="XP" aria-valuemin={0} aria-valuemax={span} aria-valuenow={xp - levelXp}>
        <span style={{ width: `${((xp - levelXp) / span) * 100}%` }} />
      </span>
    </>
  );
}
