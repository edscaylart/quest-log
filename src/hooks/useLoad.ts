import { useEffect, useState, type DependencyList } from "react";
import { toCoreError } from "@/lib/errors";

/**
 * Runs `load` on mount and whenever `deps` change. A response that lands after
 * unmount or after `deps` changed is dropped, so an older load never replaces a
 * newer one. A load of `null` skips that run and keeps the last data and error.
 */
export function useLoad<T>(load: () => Promise<T> | null, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    load()?.then(
      (d) => {
        if (!current) return;
        setData(d);
        setError(null);
      },
      (err) => current && setError(toCoreError(err).message),
    );
    return () => {
      current = false;
    };
  }, deps);

  return { data, error, setData };
}
