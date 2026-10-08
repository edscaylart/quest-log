// Hand-mirrored from src-tauri/src/core/projects.rs. Canonical domain terms only.

export type Project = { id: number; clientId: number; name: string; /** null uses the client's rate. */ rateCents: number | null; /** What its time bills at. */ effectiveRateCents: number; complete: boolean };
/** `rate` blank uses the client's. */
export type ProjectInput = { name: string; rate: string };
