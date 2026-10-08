import type { LastBackup } from "@/lib/backups/types";
import { formatDate, localDate } from "@/lib/format";

export const lastBackupText = (last: LastBackup) =>
  last.kind === "done" ? `Last backup: ${formatDate(last.date)}` : `Last backup: failed ${formatDate(last.date)} (${last.message})`;

/** Default save names, dated with the local day. */
export const backupFileName = (now: Date) => `Quest Log backup ${localDate(now)}.db`;
export const csvFileName = (now: Date) => `Quest Log time entries ${localDate(now)}.csv`;
