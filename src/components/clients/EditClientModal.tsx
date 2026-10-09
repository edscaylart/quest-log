import { useState, type FormEvent } from "react";
import { RepriceConfirm } from "@/components/projects/RepriceConfirm";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useRateEdit } from "@/hooks/projects/useRateEdit";
import { previewClientRate, updateClient } from "@/integrations/tauri/commands";
import type { Client, ClientEdit } from "@/lib/clients/types";
import { rateInput } from "@/lib/format";
import { label } from "@/lib/labels";

export function EditClientModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const initialRate = rateInput(client.rateCents);
  const [form, setForm] = useState<ClientEdit>({
    name: client.name,
    rate: initialRate,
    billingName: client.billingName ?? "",
    address: client.address ?? "",
    email: client.email ?? "",
    netDays: client.netDays?.toString() ?? "",
  });
  const { error, busy, fieldError, submit, repricing, confirm, cancel } = useRateEdit(async () => {
    await updateClient(client.id, form);
    onSaved();
  });
  const set = (field: keyof ClientEdit) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(form.rate === initialRate ? null : () => previewClientRate(client.id, form.rate));
  }

  if (repricing) return <RepriceConfirm repricing={repricing} busy={busy} onCancel={cancel} onConfirm={confirm} />;

  const text = (field: keyof ClientEdit, title: string, extra: object = {}) => (
    <Field id={`client-${field}`} label={title} error={fieldError(field)}>
      <input id={`client-${field}`} value={form[field]} onChange={set(field)} aria-invalid={!!fieldError(field)} {...extra} />
    </Field>
  );

  return (
    <Modal title={`Edit ${label.client}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        {text("name", "Name")}
        {text("rate", label.rate, { inputMode: "decimal" })}
        {text("billingName", "Billing name", { placeholder: form.name })}
        <Field id="client-address" label="Address" error={fieldError("address")}>
          <textarea id="client-address" rows={3} value={form.address} onChange={set("address")} />
        </Field>
        {text("email", "Email", { type: "email" })}
        {text("netDays", "Net days", { inputMode: "numeric", placeholder: "Default" })}
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
