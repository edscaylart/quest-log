import { label } from "@/lib/labels";

export function ClientsToolbar({
  showArchived,
  setShowArchived,
  onNew,
}: {
  showArchived: boolean;
  setShowArchived: (archived: boolean) => void;
  onNew: () => void;
}) {
  return (
    <div className="toolbar">
      <div className="segmented" role="group" aria-label={`${label.clients} shown`}>
        <button type="button" aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
          Active
        </button>
        <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
          {label.archived}
        </button>
      </div>
      <button className="primary" onClick={onNew}>
        + New {label.client}
      </button>
    </div>
  );
}
