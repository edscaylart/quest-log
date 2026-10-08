import { Modal } from "@/components/ui/Modal";
import type { Repricing } from "@/lib/clients/types";
import { formatCents, formatHours } from "@/lib/format";

export function RepriceConfirm({ repricing, busy, onCancel, onConfirm }: { repricing: Repricing; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Change rate?" onClose={onCancel}>
      <p>
        {formatHours(repricing.seconds)} uninvoiced hours reprice: {formatCents(repricing.oldCents)} → {formatCents(repricing.newCents)}
      </p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
          Reprice
        </button>
      </div>
    </Modal>
  );
}
