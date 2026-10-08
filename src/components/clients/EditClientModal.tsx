import { useState, type FormEvent } from "react";
import { RepriceConfirm } from "@/components/projects/RepriceConfirm";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { previewClientRate, updateClient } from "@/integrations/tauri/commands";
import type { Client, ClientEdit, Repricing } from "@/lib/clients/types";
import { toCoreError, type CoreError } from "@/lib/errors";
import { label } from "@/lib/labels";
import { reprices } from "@/lib/projects/reprices";

export function EditClientModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const initialRate = (client.rateCents / 100).toFixed(2);
  const [form, setForm] = useState<ClientEdit>({
    name: client.name,
    rate: initialRate,
    billingName: client.billingName ?? "",
    address: client.address ?? "",
    email: client.email ?? "",
    netDays: client.netDays?.toString() ?? "",
  });
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Repricing | null>(null);
  const set = (field: keyof ClientEdit) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });
  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(toCoreError(err));
      setConfirming(null);
    }
    setBusy(false);
  }

  const save = () =>
    run(async () => {
      await updateClient(client.id, form);
      onSaved();
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.rate === initialRate) return save();
    run(async () => {
      const repricing = await previewClientRate(client.id, form.rate);
      if (reprices(repricing)) setConfirming(repricing);
      else await save();
    });
  }

  if (confirming) return <RepriceConfirm repricing={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={save} />;

  const text = (field: keyof ClientEdit, title: string, extra: object = {}) => (
    <Field id={`client-${field}`} label={title} error={fieldError(field)}>
      <input id={`client-${field}`} value={form[field]} onChange={set(field)} aria-invalid={!!fieldError(field)} {...extra} />
    </Field>
  );

  return (
    <Modal title={`Edit ${label.client}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
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
