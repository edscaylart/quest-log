import type { DependencyList } from "react";
import { useLoad } from "@/hooks/useLoad";
import { listClients } from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";

/**
 * The Clients `filter` keeps, reloaded whenever `deps` change; `clients` is null
 * until the first load lands, and `error` holds a failed load's message. The
 * filter runs on every render, so changing it never refetches, but a filtered
 * list is a new array each render: keep it out of effect deps.
 */
export function useClients(filter?: (c: Client) => boolean, deps: DependencyList = []) {
  const { data: all, error } = useLoad(listClients, deps);
  return { clients: all && filter ? all.filter(filter) : all, error };
}
