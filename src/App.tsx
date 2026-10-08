import { useEffect, useState } from "react";
import { label } from "./labels";
import { Clients } from "./Clients";
import { Log } from "./Log";

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
      <Hud />
      <main>
        {tab === "clients" ? (
          <Clients />
        ) : tab === "log" ? (
          <Log creating={newEntry} setCreating={setNewEntry} />
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
    </div>
  );
}

// ponytail: placeholder HUD; Timer and XP arrive with their own tickets.
function Hud() {
  return (
    <header className="hud">
      <button className="primary" disabled>
        ▶ Start
      </button>
      <div className="level">
        <span className="num">Lv 1</span>
        <span className="xp" aria-label="XP" />
        <button className="ghost icon" disabled aria-label="Settings">
          ⚙
        </button>
      </div>
    </header>
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
