import { useEffect, useReducer, useRef, useState } from "react";
import { acknowledgeLevelUp } from "@/integrations/tauri/commands";
import { label } from "@/lib/labels";
import { BANNER_MS } from "@/lib/progress/constants";

/** "LEVEL UP!" for `level`, shown (and acknowledged) only while the window is in front. */
export function LevelUp({ level }: { level: number | null }) {
  const [shown, setShown] = useState<number | null>(null);
  // Until a reload catches up, `level` still holds what was already acknowledged.
  const celebrated = useRef(0);
  // Re-checked on every focus; hasFocus() is read live in case a blur was missed.
  const [focused, refocused] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    window.addEventListener("focus", refocused);
    return () => window.removeEventListener("focus", refocused);
  }, []);

  useEffect(() => {
    if (level === null || level <= celebrated.current || !document.hasFocus()) return;
    celebrated.current = level;
    setShown(level);
    // ponytail: a failed store just celebrates again next launch.
    acknowledgeLevelUp(level).catch(() => {});
  }, [level, focused]);

  useEffect(() => {
    if (shown === null) return;
    const id = setTimeout(() => setShown(null), BANNER_MS);
    return () => clearTimeout(id);
  }, [shown]);

  if (shown === null) return null;
  return (
    <div className="level-up" role="status">
      <strong>
        LEVEL UP! {label.level} {shown}
      </strong>
      <button className="ghost icon" aria-label="Dismiss" onClick={() => setShown(null)}>
        ✕
      </button>
    </div>
  );
}
