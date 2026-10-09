import { DraftEditor } from "@/components/invoices/DraftEditor";
import { SealedDetail } from "@/components/invoices/SealedDetail";
import { useFormAction } from "@/hooks/useFormAction";
import { useLoad } from "@/hooks/useLoad";
import { getInvoice } from "@/integrations/tauri/commands";
import type { Invoice as InvoiceRecord } from "@/lib/invoices/types";

/** A Draft opens editable; Sent and Paid open read-only with their state actions. */
export function Invoice({ id, version, onChange, onDeleted }: { id: number; version: number; onChange: () => void; onDeleted: () => void }) {
  const { data: invoice, setData: setInvoice } = useLoad(() => getInvoice(id), [id, version]);
  const { error: coreError, setError, fail } = useFormAction();
  const error = coreError?.message ?? null;

  if (!invoice) return null;
  const update = (action: Promise<InvoiceRecord>) =>
    action.then(
      (next) => {
        setInvoice(next);
        setError(null);
        onChange();
      },
      fail,
    );
  return invoice.state === "draft" ? (
    <DraftEditor invoice={invoice} update={update} error={error} fail={fail} onChange={onChange} onDeleted={onDeleted} />
  ) : (
    <SealedDetail invoice={invoice} update={update} error={error} setError={setError} fail={fail} />
  );
}
