import type { DependencyList } from "react";
import { useLoad } from "@/hooks/useLoad";
import { listClients } from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";

/**
 * The Clients `filter` keeps, reloaded whenever `deps` change; null until the
 * first load lands. The filter runs on every render, so changing it never refetches,
 * but a filtered list is a new array each render: keep it out of effect deps.
 */
export function useClients(filter?: (c: Client) => boolean, deps: DependencyList = []) {
  const all = useLoad(listClients, deps).data;
  return all && filter ? all.filter(filter) : all;
}
