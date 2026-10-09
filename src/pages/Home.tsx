import { useState } from "react";
import { NewClientModal } from "@/components/clients/NewClientModal";
import { AllTimeStrip } from "@/components/dashboard/AllTimeStrip";
import { Chart } from "@/components/dashboard/Chart";
import { ClientTable } from "@/components/dashboard/ClientTable";
import { FiguresList } from "@/components/dashboard/FiguresList";
import { PeriodControls } from "@/components/dashboard/PeriodControls";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { useClients } from "@/hooks/clients/useClients";
import { useDashboard } from "@/hooks/dashboard/useDashboard";
import { label } from "@/lib/labels";

export function Home({ version, onChange }: { version: number; onChange: () => void }) {
  const [creating, setCreating] = useState(false);
  const { saved, choose, offset, setOffset, data, error } = useDashboard(version);

  const { clients, error: clientsError } = useClients(undefined, [version]);

  if (!clients)
    return (
      <>
        <h1>Home</h1>
        <ErrorLine error={clientsError} />
      </>
    );
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

  return (
    <>
      <h1>Home</h1>
      {data && <AllTimeStrip allTime={data.allTime} />}
      <PeriodControls saved={saved} period={data?.period} offset={offset} setOffset={setOffset} choose={choose} />
      <ErrorLine error={clientsError ?? error} />

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
