import { listen } from "@tauri-apps/api/event";
import { useEffect, useReducer, useState } from "react";
import { getTimer, startTimer, toCoreError, type Overlong, type Stopped, type Timer } from "./api";
import { label } from "./labels";
import { Clients } from "./Clients";
import { EntryModal, Log } from "./Log";
import { Hud } from "./Timer";

// 8×8 pixel icons, one string of unit squares each.
const icons = {
  home: "M3 0h2v1h1v1h1v1h1v1H7v4H5V5H3v3H1V4H0V3h1V2h1V1h1z",
  log: "M1 0h6v8H1zM2 2h4v1H2zM2 4h4v1H2zM2 6h3v1H2z",
  clients: "M3 0h2v1h1v3H5v1H3V4H2V1h1zM1 5h6v1h1v2H0V6h1z",
  invoices: "M0 0h8v2H7v5h1v1H0V7h1V2H0z",
};

const tabs = [
  { id: "home", title: "Home" },
  { id: "log", title: "Log" },
  { id: "clients", title: label.clients },
  { id: "invoices", title: label.invoices },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [newEntry, setNewEntry] = useState(false);
  // Bumped when clients, entries or the Timer change, so every screen reloads.
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [fixing, setFixing] = useState<Overlong | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);
  const failed = (err: unknown) => setTimerError(toCoreError(err).message);

  useEffect(() => {
    getTimer().then(setTimer);
  }, [version]);

  const stopped = (outcome: Stopped | null) => {
    if (outcome?.kind === "needsEdit") setFixing(outcome.overlong);
    setTimerError(null);
    changed();
  };

  // The tray drives the same core and reports here, so the window stays current.
  useEffect(() => {
    const unlisten = [
      listen<Stopped | null>("timer-changed", (e) => stopped(e.payload)),
      listen<unknown>("tray-error", (e) => failed(e.payload)),
    ];
    return () => unlisten.forEach((u) => u.then((f) => f()));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const index = Number(e.key) - 1;
      if (e.metaKey && tabs[index]) {
        e.preventDefault();
        setTab(tabs[index].id);
      }
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        setTab("log");
        setNewEntry(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Hud timer={timer} version={version} error={timerError} onStopped={stopped} onChange={() => stopped(null)} onError={failed} />
      <main>
        {tab === "clients" ? (
          <Clients onChange={changed} />
        ) : tab === "log" ? (
          <Log
            creating={newEntry}
            setCreating={setNewEntry}
            version={version}
            onResume={(e) => startTimer({ clientId: e.clientId, note: e.note }).then(stopped, failed)}
          />
        ) : (
          <Placeholder title={tabs.find((t) => t.id === tab)!.title} />
        )}
      </main>
      <nav className="tabbar" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <svg viewBox="0 0 8 8" aria-hidden="true">
              <path d={icons[t.id]} />
            </svg>
            {t.title}
          </button>
        ))}
      </nav>
      {fixing && (
        <EntryModal
          entry={null}
          overlong={fixing}
          onClose={() => setFixing(null)}
          onSaved={() => {
            setFixing(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="hint">Nothing here yet.</p>
    </>
  );
}
