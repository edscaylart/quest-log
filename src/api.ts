import { invoke } from "@tauri-apps/api/core";

// Hand-mirrored from src-tauri/src/core. Canonical domain terms only.

export type Client = { id: number; name: string; rateCents: number };
export type NewClient = { name: string; rate: string };

export type CoreError =
  | { kind: "invalid"; field: string; message: string }
  | { kind: "database"; message: string };

export const isCoreError = (e: unknown): e is CoreError => typeof e === "object" && e !== null && "kind" in e;

export const createClient = (input: NewClient) => invoke<Client>("create_client", { input });
export const listClients = () => invoke<Client[]>("list_clients");
