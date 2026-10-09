import { useState } from "react";
import { InvoiceList } from "@/components/invoices/InvoiceList";
import { NewDraftModal } from "@/components/invoices/NewDraftModal";
import { useLoad } from "@/hooks/useLoad";
import { useNav } from "@/hooks/useNav";
import { listInvoices } from "@/integrations/tauri/commands";
import { label } from "@/lib/labels";

export function Invoices({ version, onChange }: { version: number; onChange: () => void }) {
  const [creating, setCreating] = useState(false);
  const { push } = useNav();
  const invoices = useLoad(listInvoices, [version]).data;

  return (
    <>
      <h1>{label.invoices}</h1>
      <button className="primary" onClick={() => setCreating(true)}>
        + New {label.invoice}
      </button>
      {invoices?.length === 0 && <p className="hint">No {label.invoices} yet.</p>}
      <InvoiceList invoices={invoices ?? []} />
      {creating && (
        <NewDraftModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            push({ kind: "invoice", id });
            onChange();
          }}
        />
      )}
    </>
  );
}
