import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";

/** Asks before acting; `onConfirm` acts. */
export function Confirm({ title, children, action, onClose, onConfirm }: { title: string; children: ReactNode; action: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      {children}
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {action}
        </button>
      </div>
    </Modal>
  );
}
