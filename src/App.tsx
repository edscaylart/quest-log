import { useEffect, useReducer, useState } from "react";
import { Client } from "@/pages/Client";
import { Clients } from "@/pages/Clients";
import { Home } from "@/pages/Home";
import { Invoice } from "@/pages/Invoice";
import { Invoices } from "@/pages/Invoices";
import { LevelUp } from "@/components/progress/LevelUp";
import { TimeEntryModal } from "@/components/time-entries/TimeEntryModal";
import { Hud } from "@/components/timer/Hud";
import { useFormAction } from "@/hooks/useFormAction";
import { useLoad } from "@/hooks/useLoad";
import { Nav, type Screen } from "@/hooks/useNav";
import { getProgress, getTimer, startTimer } from "@/integrations/tauri/commands";
import { onTimerChanged, onTrayError } from "@/integrations/tauri/events";
import { label } from "@/lib/labels";
import type { Overlong, Stopped } from "@/lib/timer/types";
import { Log } from "@/pages/Log";
import { Project } from "@/pages/Project";
import { Settings } from "@/pages/Settings";

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
  // Each tab's own push stack; switching tabs leaves them as they are.
  const [stacks, setStacks] = useState<Record<Tab, Screen[]>>({ home: [], log: [], clients: [], invoices: [] });
  const stack = stacks[tab];
  const top = stack.at(-1);
  const setStack = (next: Screen[]) => setStacks({ ...stacks, [tab]: next });
  const back = () => setStack(stack.slice(0, -1));
  const openSettings = () => {
    if (top?.kind !== "settings") setStack([...stack, { kind: "settings" }]);
  };
  const [newEntry, setNewEntry] = useState(false);
  // Bumped when clients, entries or the Timer change, so every screen reloads.
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  const { data: timer, error: timerLoadError } = useLoad(getTimer, [version]);
  const [fixing, setFixing] = useState<Overlong | null>(null);
  const { error: timerError, setError: setTimerError, fail: failed } = useFormAction();

  const { data: progress, error: progressError } = useLoad(getProgress, [version]);

  const stopped = (outcome: Stopped | null) => {
    if (outcome?.kind === "needsEdit") setFixing(outcome.overlong);
    setTimerError(null);
    changed();
  };

  // The tray drives the same core and reports here, so the window stays current.
  useEffect(() => {
    const unlisten = [
      onTimerChanged(stopped),
      onTrayError(failed),
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
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        setTab("log");
        setNewEntry(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stack, tab]);

  return (
    <div className="app">
      <Hud timer={timer} progress={progress} version={version} error={timerError?.message ?? timerLoadError ?? progressError} onStopped={stopped} onChange={() => stopped(null)} onError={failed} onSettings={openSettings} />
      <LevelUp level={progress?.levelUp ?? null} />
      <main>
        <Nav.Provider value={{ push: (screen) => setStack([...stack, screen]) }}>
        {top && (
          <button className="ghost back" onClick={back}>
            ◀ Back
          </button>
        )}
        {top?.kind === "settings" ? (
          <Settings />
        ) : top?.kind === "client" ? (
          <Client
            key={top.id}
            id={top.id}
            version={version}
            onChange={changed}
            onDeleted={() => {
              back();
              changed();
            }}
          />
        ) : top?.kind === "project" ? (
          <Project
            key={top.id}
            id={top.id}
            version={version}
            onChange={changed}
            onDeleted={() => {
              back();
              changed();
            }}
          />
        ) : top?.kind === "invoice" ? (
          <Invoice
            key={top.id}
            id={top.id}
            version={version}
            onChange={changed}
            onDeleted={() => {
              back();
              changed();
            }}
          />
        ) : tab === "home" ? (
          <Home version={version} onChange={changed} />
        ) : tab === "clients" ? (
          <Clients version={version} onChange={changed} />
        ) : tab === "log" ? (
          <Log
            creating={newEntry}
            setCreating={setNewEntry}
            version={version}
            onChange={changed}
            onResume={(e) => startTimer({ clientId: e.clientId, projectId: e.projectId, note: e.note }).then(stopped, failed)}
          />
        ) : tab === "invoices" ? (
          <Invoices version={version} onChange={changed} />
        ) : null}
        </Nav.Provider>
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
        <TimeEntryModal
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
