import { useEffect, useState } from "react";
import { getDashboard, listClients, toCoreError, type Client, type Dashboard, type Figures, type Preset } from "./api";
import { NewClientModal } from "./Clients";
import { formatCents, formatDay, formatMonthDay, formatRange, formatSeconds } from "./format";
import { label } from "./labels";
import { useNav } from "./nav";

const presets: { id: Preset; title: string }[] = [
  { id: "1w", title: "1W" },
  { id: "2w", title: "2W" },
  { id: "3w", title: "3W" },
  { id: "month", title: "M" },
  { id: "custom", title: "Custom" },
];

/** Custom's own days; null for the other presets. */
type Range = { start: string; end: string } | null;
type Saved = { preset: Preset; range: Range };

const STORAGE_KEY = "home.period";
// The running Timer counts live; H:MM only changes once a minute.
const REFRESH_MS = 60_000;

// ponytail: a per-device view preference, so browser storage rather than core.
function loadSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    if (saved && presets.some((p) => p.id === saved.preset)) return saved;
  } catch {}
  return { preset: "1w", range: null };
}

function save(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {}
}

export function Home({ version, onChange }: { version: number; onChange: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [{ preset, range }, setSaved] = useState(loadSaved);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const choose = (next: Saved) => {
    setSaved(next);
    setOffset(0);
    save(next);
  };

  useEffect(() => {
    listClients().then(setClients);
  }, [version]);

  useEffect(() => {
    // A slower, older response must not replace a newer period.
    let current = true;
    const load = () =>
      getDashboard({ preset, offset, start: range?.start ?? null, end: range?.end ?? null }).then(
        (d) => {
          if (!current) return;
          setData(d);
          setError(null);
          // Custom reopens on the days last shown, steps included.
          if (preset === "custom") save({ preset, range: d.period });
        },
        (err) => current && setError(toCoreError(err).message),
      );
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [preset, range?.start, range?.end, offset, version]);

  if (!clients) return <h1>Home</h1>;
  if (clients.length === 0)
    return (
      <>
        <h1>Home</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          Add your first {label.client}
        </button>
        {creating && (
          <NewClientModal
            onClose={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              onChange();
            }}
          />
        )}
      </>
    );

  // A custom date edit keeps the other end as shown and restarts stepping from there.
  const edit = (side: "start" | "end") => (e: { target: { value: string } }) => {
    if (e.target.value && data) choose({ preset: "custom", range: { ...data.period, [side]: e.target.value } });
  };

  return (
    <>
      <h1>Home</h1>
      {data && (
        <section className="strip" aria-label="All time">
          <span>
            {label.invoicedUnpaid} {formatCents(data.allTime.invoicedUnpaidCents)} · {data.allTime.overdue} overdue {label.invoices}
          </span>
          <span>
            {label.uninvoiced} {formatCents(data.allTime.uninvoicedCents)}
          </span>
        </section>
      )}

      <div className="segmented" role="group" aria-label="Period">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => choose({ preset: p.id, range: p.id === "custom" ? (data?.period ?? range) : null })}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div className="toolbar stepper">
        <button className="ghost" aria-label="Previous period" onClick={() => setOffset(offset - 1)}>
          ◀
        </button>
        {preset === "custom" && data ? (
          <div className="pair">
            {/* Uncommitted until a full date; remounts when the shown days change. */}
            <input key={`s${data.period.start}`} type="date" aria-label="From" defaultValue={data.period.start} onChange={edit("start")} />
            <input key={`e${data.period.end}`} type="date" aria-label="To" defaultValue={data.period.end} onChange={edit("end")} />
          </div>
        ) : (
          <span className="range">{data && formatRange(data.period.start, data.period.end)}</span>
        )}
        <button className="ghost" aria-label="Next period" onClick={() => setOffset(offset + 1)}>
          ▶
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <section aria-label="Period totals">
            <FiguresList figures={data.total} />
          </section>
          {data.total.seconds === 0 && <p className="hint">No time logged — start a Timer</p>}
          <Chart data={data} />
          {data.clients.length > 0 && <ClientTable rows={data.clients} />}
        </>
      )}
    </>
  );
}

const columns: { title: string; value: (f: Figures) => string }[] = [
  { title: "Hours", value: (f) => formatSeconds(f.seconds) },
  { title: "Earned", value: (f) => formatCents(f.earnedCents) },
  { title: label.uninvoiced, value: (f) => formatCents(f.uninvoicedCents) },
  { title: label.invoicedUnpaid, value: (f) => formatCents(f.invoicedUnpaidCents) },
  { title: label.paid, value: (f) => formatCents(f.paidCents) },
];

function FiguresList({ figures }: { figures: Figures }) {
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

function ClientTable({ rows }: { rows: Dashboard["clients"] }) {
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

/** One bar per bucket; hover, focus or tap shows its value. */
function Chart({ data }: { data: Dashboard }) {
  const [shown, setShown] = useState<number | null>(null);
  const max = Math.max(0, ...data.buckets.map((b) => b.seconds));
  const name = (start: string) => (data.weekly ? `Week of ${formatMonthDay(start)}` : formatDay(start));
  const current = shown == null ? null : data.buckets[shown];

  return (
    <figure className="chart" role="group" aria-label={data.weekly ? "Hours per week" : "Hours per day"}>
      <p className="hint" aria-live="polite">
        {current ? `${name(current.start)} · ${formatSeconds(current.seconds)}` : " "}
      </p>
      <div className="bars" onMouseLeave={() => setShown(null)}>
        {data.buckets.map((b, i) => (
          <button
            key={b.start}
            type="button"
            aria-label={`${name(b.start)}: ${formatSeconds(b.seconds)}`}
            aria-pressed={shown === i}
            onMouseEnter={() => setShown(i)}
            onFocus={() => setShown(i)}
            onClick={() => setShown(i)}
          >
            <span style={{ height: `${max ? (b.seconds / max) * 100 : 0}%` }} />
          </button>
        ))}
      </div>
    </figure>
  );
}
