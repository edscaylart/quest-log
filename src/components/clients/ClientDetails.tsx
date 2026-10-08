import type { Client } from "@/lib/clients/types";
import { formatCents } from "@/lib/format";
import { label } from "@/lib/labels";

export function ClientDetails({
  client,
  onEdit,
  onToggleArchived,
  onDelete,
}: {
  client: Client;
  onEdit: () => void;
  onToggleArchived: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <dl className="details">
        <dt>{label.rate}</dt>
        <dd className="num">
          {formatCents(client.rateCents)} {label.rate}
        </dd>
        <dt>Billing name</dt>
        <dd>{client.billingName ?? client.name}</dd>
        <dt>Address</dt>
        <dd className="multiline">{client.address ?? "—"}</dd>
        <dt>Email</dt>
        <dd>{client.email ?? "—"}</dd>
        <dt>Terms</dt>
        <dd>{client.netDays == null ? "Default" : `Net ${client.netDays}`}</dd>
        <dt>Status</dt>
        <dd>{client.archived ? label.archived : "Active"}</dd>
      </dl>
      <div className="toolbar">
        <button className="ghost" aria-label={`Edit ${label.client}`} onClick={onEdit}>
          Edit
        </button>
        <button className="ghost" onClick={onToggleArchived}>
          {client.archived ? label.unarchive : label.archive}
        </button>
        <button className="ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  );
}
