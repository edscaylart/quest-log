import { useEffect, useReducer, useState } from "react";
import { useLoad } from "@/hooks/useLoad";
import { getDashboard } from "@/integrations/tauri/commands";
import { REFRESH_MS } from "@/lib/dashboard/constants";
import { periodInput } from "@/lib/dashboard/periodInput";
import { loadSaved, save, type Saved } from "@/lib/dashboard/savedPeriod";

/** The saved Period choice, its step offset, and the Dashboard for it, refreshed every minute. */
export function useDashboard(version: number) {
  const [saved, setSaved] = useState(loadSaved);
  const { preset, range } = saved;
  const [offset, setOffset] = useState(0);
  const [tick, refresh] = useReducer((n: number) => n + 1, 0);

  const choose = (next: Saved) => {
    setSaved(next);
    setOffset(0);
    save(next);
  };

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const { data, error } = useLoad(
    () => getDashboard(periodInput(preset, offset, range)),
    [preset, range?.start, range?.end, offset, version, tick],
  );

  // Custom reopens on the days last shown, steps included. Only loads for the current period land in `data`.
  useEffect(() => {
    if (data && preset === "custom") save({ preset, range: data.period });
  }, [data]);

  return { saved, choose, offset, setOffset, data, error };
}
