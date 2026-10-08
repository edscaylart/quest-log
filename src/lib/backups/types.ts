// Hand-mirrored from src-tauri/src/core/backups.rs. Canonical domain terms only.

/** How the launch's daily backup went. Dates are local days, YYYY-MM-DD. */
export type LastBackup = { kind: "done"; date: string } | { kind: "failed"; date: string; message: string };
export type DataInfo = { path: string; lastBackup: LastBackup };
