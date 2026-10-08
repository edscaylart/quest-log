import { useEffect, useState } from "react";
import { getDashboard } from "@/integrations/tauri/commands";
import { REFRESH_MS } from "@/lib/dashboard/constants";
import { loadSaved, save, type Saved } from "@/lib/dashboard/savedPeriod";
import type { Dashboard } from "@/lib/dashboard/types";
import { toCoreError } from "@/lib/errors";

/** The saved Period choice, its step offset, and the Dashboard for it, refreshed every minute. */
export function useDashboard(version: number) {
  const [saved, setSaved] = useState(loadSaved);
  const { preset, range } = saved;
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: Saved) => {
    setSaved(next);
    setOffset(0);
    save(next);
  };

  useEffect(() => {
    // A slower, older response must not replace a newer period.
    let current = true;
    const load = () =>
      getDashboard({ preset, offset, start: range?.start ?? null, end: range?.end ?? null }).then(
        (d) => {
          if (!current) return;
          setData(d);
          setError(null);
          // Custom reopens on the days last shown, steps included.
          if (preset === "custom") save({ preset, range: d.period });
        },
        (err) => current && setError(toCoreError(err).message),
      );
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [preset, range?.start, range?.end, offset, version]);

  return { saved, choose, offset, setOffset, data, error };
}
