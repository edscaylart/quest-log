import { useNav } from "@/hooks/useNav";
import { columns } from "@/lib/dashboard/columns";
import type { Dashboard } from "@/lib/dashboard/types";
import { label } from "@/lib/labels";

export function ClientTable({ rows }: { rows: Dashboard["clients"] }) {
  const { push } = useNav();
  return (
    <div className="scroll-x">
      <table className="figures-table">
        <thead>
          <tr>
            <th>{label.client}</th>
            {columns.map((c) => (
              <th key={c.title}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.clientId}>
              <td>
                <button className="link" onClick={() => push({ kind: "client", id: r.clientId })}>
                  {r.clientName}
                </button>
              </td>
              {columns.map((c) => (
                <td key={c.title} className="num">
                  {c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
