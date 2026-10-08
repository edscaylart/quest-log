import { useState, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { createClient } from "@/integrations/tauri/commands";
import { toCoreError, type CoreError } from "@/lib/errors";
import { label } from "@/lib/labels";

export function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createClient({ name, rate });
      onCreated();
    } catch (err) {
      setError(toCoreError(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`New ${label.client}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="client-name" label="Name" error={fieldError("name")}>
          <input id="client-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!fieldError("name")} />
        </Field>
        <Field id="client-rate" label={label.rate} error={fieldError("rate")}>
          <input
            id="client-rate"
            inputMode="decimal"
            placeholder="85.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={!!fieldError("rate")}
          />
        </Field>
        {error && error.kind !== "invalid" && <p className="error">{error.message}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
