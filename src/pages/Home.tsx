import { useEffect, useState } from "react";
import { NewClientModal } from "@/components/clients/NewClientModal";
import { AllTimeStrip } from "@/components/dashboard/AllTimeStrip";
import { Chart } from "@/components/dashboard/Chart";
import { ClientTable } from "@/components/dashboard/ClientTable";
import { FiguresList } from "@/components/dashboard/FiguresList";
import { PeriodControls } from "@/components/dashboard/PeriodControls";
import { useDashboard } from "@/hooks/dashboard/useDashboard";
import { listClients } from "@/integrations/tauri/commands";
import type { Client } from "@/lib/clients/types";
import { label } from "@/lib/labels";

export function Home({ version, onChange }: { version: number; onChange: () => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { saved, choose, offset, setOffset, data, error } = useDashboard(version);

  useEffect(() => {
    listClients().then(setClients);
  }, [version]);

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

  return (
    <>
      <h1>Home</h1>
      {data && <AllTimeStrip allTime={data.allTime} />}
      <PeriodControls saved={saved} period={data?.period} offset={offset} setOffset={setOffset} choose={choose} />
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
