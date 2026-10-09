import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useClients } from "@/hooks/clients/useClients";
import { useFormAction } from "@/hooks/useFormAction";
import { useLoad } from "@/hooks/useLoad";
import { createDraft, draftCandidates } from "@/integrations/tauri/commands";
import { formatRange } from "@/lib/format";
import { entryLabel } from "@/lib/invoices/entryLabel";
import { periodInput, type PeriodChoice } from "@/lib/invoices/periodInput";
import type { DraftCandidates } from "@/lib/invoices/types";
import { label } from "@/lib/labels";

const choices = [
  { kind: "2w", title: "Last 2 weeks" },
  { kind: "month", title: "Last month" },
] as const;

export function NewDraftModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  // A retired client only while it has time left to bill.
  const clients = useClients((c) => !c.archived || c.hasAvailable);
  const [pickedClientId, setPickedClientId] = useState(0);
  const clientId = pickedClientId || (clients?.[0]?.id ?? 0);
  const [choice, setChoice] = useState<PeriodChoice>({ kind: "default" });
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const { error: createError, busy, run } = useFormAction();
  const [failedFor, setFailedFor] = useState<DraftCandidates | null>(null);

  const custom = choice.kind === "custom" ? choice : null;
  const { data: candidates, error: loadError } = useLoad(
    () => (clientId ? draftCandidates(clientId, periodInput(choice)) : null),
    [clientId, choice.kind, custom?.start, custom?.end],
  );
  // A failed create shows until a newer load replaces the candidates it was for.
  const error = loadError ?? (failedFor === candidates ? (createError?.message ?? null) : null);

  const period = candidates?.period;
  const toggle = (id: number) => {
    const next = new Set(unticked);
    if (!next.delete(id)) next.add(id);
    setUnticked(next);
  };

  async function create() {
    if (!period || !candidates) return;
    const ok = await run(async () => {
      const entryIds = candidates.entries.map((e) => e.id).filter((id) => !unticked.has(id));
      const invoice = await createDraft({ clientId, start: period.start, end: period.end, entryIds });
      onCreated(invoice.id);
    });
    if (!ok) setFailedFor(candidates);
  }

  return (
    <Modal title={`New ${label.invoice}`} onClose={onClose}>
      {clients?.length === 0 ? (
        <p className="hint">Add a {label.client} first.</p>
      ) : (
        <>
          <Field id="draft-client" label={label.client} error={null}>
            <select
              id="draft-client"
              value={clientId}
              onChange={(e) => {
                setPickedClientId(Number(e.target.value));
                setChoice({ kind: "default" });
              }}
            >
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.archived ? `${c.name} (${label.archived})` : c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="segmented" role="group" aria-label="Period">
            {choices.map((c) => (
              <button key={c.kind} type="button" aria-pressed={choice.kind === c.kind} onClick={() => setChoice({ kind: c.kind })}>
                {c.title}
              </button>
            ))}
            <button type="button" aria-pressed={!!custom} onClick={() => period && !custom && setChoice({ kind: "custom", ...period })}>
              Custom
            </button>
          </div>
          {custom ? (
            <div className="pair">
              <Field id="draft-start" label="Start" error={null}>
                <input id="draft-start" type="date" value={custom.start} onChange={(e) => setChoice({ ...custom, start: e.target.value })} />
              </Field>
              <Field id="draft-end" label="End" error={null}>
                <input id="draft-end" type="date" value={custom.end} onChange={(e) => setChoice({ ...custom, end: e.target.value })} />
              </Field>
            </div>
          ) : (
            period && <p>{formatRange(period.start, period.end)}</p>
          )}
          {candidates && candidates.older > 0 && candidates.olderSince && period && (
            <p className="hint">
              <button type="button" className="link" onClick={() => setChoice({ kind: "custom", start: candidates.olderSince!, end: period.end })}>
                {candidates.older} older uninvoiced {candidates.older === 1 ? "entry" : "entries"} — include?
              </button>
            </p>
          )}
          {candidates?.entries.length === 0 && <p className="hint">No uninvoiced time in this period.</p>}
          <ul className="rows">
            {candidates?.entries.map((e) => (
              <li key={e.id} className="row">
                <label>
                  <input type="checkbox" checked={!unticked.has(e.id)} onChange={() => toggle(e.id)} /> {entryLabel(e)}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || !candidates} onClick={create}>
          Create
        </button>
      </div>
    </Modal>
  );
}
