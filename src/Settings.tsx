import { useEffect, useState, type FormEvent } from "react";
import { getSettings, toCoreError, updateSettings, type CoreError, type SettingsEdit } from "./api";
import { Field } from "./Modal";

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
      {/* ponytail: placeholder until #13 fills Data (file location, backups, CSV). */}
      <section className="day" aria-label="Data">
        <h2>Data</h2>
        <p className="hint">Nothing here yet.</p>
      </section>
    </>
  );
}
