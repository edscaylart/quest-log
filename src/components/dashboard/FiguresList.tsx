import { columns } from "@/lib/dashboard/columns";
import type { Figures } from "@/lib/dashboard/types";
import { formatBrl } from "@/lib/format";

export function FiguresList({ figures, usdBrl }: { figures: Figures; usdBrl: number | null }) {
  return (
    <dl className="figures">
      {columns.map((c) => (
        <div key={c.title}>
          <dt>{c.title}</dt>
          <dd className="num">{c.value(figures)}</dd>
          {usdBrl && c.cents && <dd className="num brl">{formatBrl(c.cents(figures), usdBrl)}</dd>}
        </div>
      ))}
    </dl>
  );
}
