import { useEffect, useState } from "react";

/** Whole seconds since the Timer started, ticking. Wall clock, so sleep doesn't lose time. */
export function useElapsed(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
