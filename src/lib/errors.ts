// Hand-mirrored from src-tauri/src/core/mod.rs.

export type CoreError =
  | { kind: "invalid"; field: string; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "database"; message: string };

export const isCoreError = (e: unknown): e is CoreError => typeof e === "object" && e !== null && "kind" in e;
/** Anything that isn't a core error (e.g. IPC failure) still carries its message. */
export const toCoreError = (e: unknown): CoreError => (isCoreError(e) ? e : { kind: "database", message: String(e) });
