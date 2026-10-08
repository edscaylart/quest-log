import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState, type FormEvent } from "react";
import {
  backUpNow,
  exportCsv,
  getDataInfo,
  getSettings,
  inspectBackup,
  listClients,
  restoreBackup,
  revealDatabase,
  toCoreError,
  updateSettings,
  type Client,
  type CoreError,
  type DataInfo,
  type LastBackup,
  type SettingsEdit,
} from "./api";
import { formatDate, localDate } from "./format";
import { loadSaved, presets, type Saved } from "./Home";
import { label } from "./labels";
import { Field, Modal } from "./Modal";

export function SettingsScreen() {
  const [form, setForm] = useState<SettingsEdit | null>(null);
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) =>
      setForm({
        name: s.name,
        businessName: s.businessName ?? "",
        address: s.address ?? "",
        email: s.email ?? "",
        taxId: s.taxId ?? "",
        paymentInstructions: s.paymentInstructions ?? "",
        netDays: s.netDays.toString(),
        invoicePrefix: s.invoicePrefix,
        nextInvoiceNumber: s.nextInvoiceNumber.toString(),
      }),
    );
  }, []);

  if (!form) return null;
  const set = (field: keyof SettingsEdit) => (e: { target: { value: string } }) => {
    setForm({ ...form, [field]: e.target.value });
    setSaved(false);
  };
  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateSettings(form!);
      setError(null);
      setSaved(true);
    } catch (err) {
      setError(toCoreError(err));
    }
    setBusy(false);
  }

  const text = (field: keyof SettingsEdit, title: string, extra: object = {}) => (
    <Field id={`settings-${field}`} label={title} error={fieldError(field)}>
      <input id={`settings-${field}`} value={form[field]} onChange={set(field)} aria-invalid={!!fieldError(field)} {...extra} />
    </Field>
  );
  const area = (field: keyof SettingsEdit, title: string) => (
    <Field id={`settings-${field}`} label={title} error={null}>
      <textarea id={`settings-${field}`} rows={3} value={form[field]} onChange={set(field)} />
    </Field>
  );

  return (
    <>
      <h1>Settings</h1>
      <form onSubmit={submit} noValidate>
        <section className="day" aria-label="Business details">
          <h2>Business details</h2>
          {text("name", "Name")}
          {text("businessName", "Business name")}
          {area("address", "Address")}
          {text("email", "Email", { type: "email" })}
          {text("taxId", "Tax ID")}
          {area("paymentInstructions", "Payment instructions")}
        </section>
        <section className="day" aria-label="Invoicing">
          <h2>Invoicing</h2>
          {text("netDays", "Net days", { inputMode: "numeric" })}
          {text("invoicePrefix", "Invoice prefix")}
          {text("nextInvoiceNumber", "Next invoice number", { inputMode: "numeric" })}
        </section>
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          {saved && (
            <p className="hint" role="status">
              Saved
            </p>
          )}
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
      <DataSection />
    </>
  );
}

function DataSection() {
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
      const path = await save({ defaultPath: `Quest Log backup ${localDate(new Date())}.db`, filters: [{ name: "Database", extensions: ["db"] }] });
      if (!path) return;
      await backUpNow(path);
      setDone("Backed up");
    });

  const exportEntries = () =>
    attempt(async () => {
      const path = await save({ defaultPath: `Quest Log time entries ${localDate(new Date())}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      const csv = await exportCsv({ preset, offset: 0, start: range?.start ?? null, end: range?.end ?? null }, clientId);
      await writeFile(path, new TextEncoder().encode(csv));
      setDone("Exported");
    });
  const setRange = (side: "start" | "end") => (e: { target: { value: string } }) =>
    setPeriod({ preset, range: { start: range?.start ?? "", end: range?.end ?? "", [side]: e.target.value } });

  const pickBackup = () =>
    attempt(async () => {
      const path = await open({ filters: [{ name: "Database", extensions: ["db"] }] });
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

const lastBackupText = (last: LastBackup) =>
  last.kind === "done" ? `Last backup: ${formatDate(last.date)}` : `Last backup: failed ${formatDate(last.date)} (${last.message})`;
