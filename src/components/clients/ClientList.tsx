import { useNav } from "@/hooks/useNav";
import type { Client } from "@/lib/clients/types";
import { formatCents } from "@/lib/format";
import { label } from "@/lib/labels";

export function ClientList({ clients }: { clients: Client[] }) {
  const { push } = useNav();
  return (
    <ul className="rows">
      {clients.map((c) => (
        <li key={c.id} className="row entry">
          <button onClick={() => push({ kind: "client", id: c.id })}>
            <span className="note">{c.name}</span>
            <span className="num">
              {formatCents(c.rateCents)} {label.rate}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
