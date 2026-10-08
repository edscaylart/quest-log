import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { backUpNow, exportCsv, getDataInfo, inspectBackup, listClients, restoreBackup, revealDatabase } from "@/integrations/tauri/commands";
import { pickFile, pickSavePath, saveBytes } from "@/integrations/tauri/files";
import type { DataInfo } from "@/lib/backups/types";
import type { Client } from "@/lib/clients/types";
import { loadSaved, presets, type Saved } from "@/lib/dashboard/savedPeriod";
import { toCoreError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/labels";
import { backupFileName, csvFileName, lastBackupText } from "@/lib/settings/dataFiles";

const databaseFile = { name: "Database", extension: "db" };

export function DataSection() {
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<{ path: string; date: string } | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  // The Dashboard's period at offset 0; Custom starts on the days it last showed.
  const [{ preset, range }, setPeriod] = useState<Saved>(loadSaved);
  const [clientId, setClientId] = useState<number | null>(null);

  useEffect(() => {
    getDataInfo().then(setInfo);
    listClients().then(setClients);
  }, []);

  async function attempt(action: () => Promise<void>) {
    setError(null);
    setDone(null);
    try {
      await action();
    } catch (err) {
      setError(toCoreError(err).message);
    }
  }

  const backUp = () =>
    attempt(async () => {
      const path = await pickSavePath(backupFileName(new Date()), databaseFile);
      if (!path) return;
      await backUpNow(path);
      setDone("Backed up");
    });

  const exportEntries = () =>
    attempt(async () => {
      const saved = await saveBytes(csvFileName(new Date()), { name: "CSV", extension: "csv" }, async () =>
        new TextEncoder().encode(await exportCsv({ preset, offset: 0, start: range?.start ?? null, end: range?.end ?? null }, clientId)),
      );
      if (saved) setDone("Exported");
    });
  const setRange = (side: "start" | "end") => (e: { target: { value: string } }) =>
    setPeriod({ preset, range: { start: range?.start ?? "", end: range?.end ?? "", [side]: e.target.value } });

  const pickBackup = () =>
    attempt(async () => {
      const path = await pickFile(databaseFile);
      if (!path) return;
      setRestoring({ path, date: (await inspectBackup(path)).date });
    });

  // On success the app restarts with the restored data.
  const restore = (path: string) => attempt(() => restoreBackup(path)).then(() => setRestoring(null));

  return (
    <section className="day" aria-label="Data">
      <h2>Data</h2>
      {info && (
        <>
          <p>{info.path}</p>
          <p className="hint">{lastBackupText(info.lastBackup)}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {done && (
          <p className="hint" role="status">
            {done}
          </p>
        )}
        <button type="button" onClick={() => attempt(revealDatabase)}>
          Reveal in Finder
        </button>
        <button type="button" onClick={backUp}>
          Back up now
        </button>
        <button type="button" onClick={pickBackup}>
          Restore from backup…
        </button>
      </div>
      <h3>Export time entries</h3>
      <div className="toolbar">
        <select aria-label="Export period" value={preset} onChange={(e) => setPeriod({ preset: e.target.value as Saved["preset"], range })}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <div className="pair">
            <input type="date" aria-label="From" value={range?.start ?? ""} onChange={setRange("start")} />
            <input type="date" aria-label="To" value={range?.end ?? ""} onChange={setRange("end")} />
          </div>
        )}
        <select aria-label={`Export ${label.client}`} value={clientId ?? ""} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{label.allClients}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.archived ? `${c.name} (${label.archived})` : c.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={exportEntries}>
          Export CSV…
        </button>
      </div>
      {restoring && (
        <Modal title="Restore backup?" onClose={() => setRestoring(null)}>
          <p>Replace all data with backup from {formatDate(restoring.date)}?</p>
          <p className="hint">Your current data is backed up first.</p>
          <div className="actions">
            <button type="button" onClick={() => setRestoring(null)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => restore(restoring.path)}>
              Restore
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
