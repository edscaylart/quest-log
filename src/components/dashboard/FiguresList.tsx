import { columns } from "@/lib/dashboard/columns";
import type { Figures } from "@/lib/dashboard/types";

export function FiguresList({ figures }: { figures: Figures }) {
  return (
    <dl className="figures">
      {columns.map((c) => (
        <div key={c.title}>
          <dt>{c.title}</dt>
          <dd className="num">{c.value(figures)}</dd>
        </div>
      ))}
    </dl>
  );
}
