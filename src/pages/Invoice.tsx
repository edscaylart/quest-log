import { useEffect, useState } from "react";
import { DraftEditor } from "@/components/invoices/DraftEditor";
import { SealedDetail } from "@/components/invoices/SealedDetail";
import { getInvoice } from "@/integrations/tauri/commands";
import { toCoreError } from "@/lib/errors";
import type { Invoice as InvoiceRecord } from "@/lib/invoices/types";

/** A Draft opens editable; Sent and Paid open read-only with their state actions. */
export function Invoice({ id, version, onChange, onDeleted }: { id: number; version: number; onChange: () => void; onDeleted: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvoice(id).then(setInvoice);
  }, [id, version]);

  if (!invoice) return null;
  const update = (action: Promise<InvoiceRecord>) =>
    action.then(
      (next) => {
        setInvoice(next);
        setError(null);
        onChange();
      },
      (err) => setError(toCoreError(err).message),
    );
  return invoice.state === "draft" ? (
    <DraftEditor invoice={invoice} update={update} error={error} setError={setError} onChange={onChange} onDeleted={onDeleted} />
  ) : (
    <SealedDetail invoice={invoice} update={update} error={error} setError={setError} />
  );
}
