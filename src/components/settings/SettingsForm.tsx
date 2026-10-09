import { useState, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import { useFormAction } from "@/hooks/useFormAction";
import { updateSettings } from "@/integrations/tauri/commands";
import type { Settings, SettingsEdit } from "@/lib/settings/types";

export function SettingsForm({ settings: s }: { settings: Settings }) {
  const [form, setForm] = useState<SettingsEdit>({
    name: s.name,
    businessName: s.businessName ?? "",
    address: s.address ?? "",
    email: s.email ?? "",
    taxId: s.taxId ?? "",
    paymentInstructions: s.paymentInstructions ?? "",
    netDays: s.netDays.toString(),
    invoicePrefix: s.invoicePrefix,
    nextInvoiceNumber: s.nextInvoiceNumber.toString(),
  });
  const { error, busy, run, fieldError } = useFormAction();
  const [saved, setSaved] = useState(false);

  const set = (field: keyof SettingsEdit) => (e: { target: { value: string } }) => {
    setForm({ ...form, [field]: e.target.value });
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await updateSettings(form);
      setSaved(true);
    });
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
  );
}
