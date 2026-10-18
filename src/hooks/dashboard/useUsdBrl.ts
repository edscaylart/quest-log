import { useEffect, useState } from "react";
import { fetchUsdBrl } from "@/integrations/awesomeapi/usdBrl";
import { getSettings } from "@/integrations/tauri/commands";

/** The USD→BRL rate for Home's BRL estimate, fetched once per mount; null while loading or on any failure. */
// ponytail: refetches each time Home mounts; cache it if the API's rate limit bites.
export function useUsdBrl() {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    getSettings()
      .then((s) => fetchUsdBrl(s.awesomeapiToken))
      .catch(() => null)
      .then((r) => live && setRate(r));
    return () => {
      live = false;
    };
  }, []);
  return rate;
}
