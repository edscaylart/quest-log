import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { Client } from "@/lib/clients/types";
import type { Project } from "@/lib/projects/types";
import type { TimeEntry } from "@/lib/time-entries/types";
import { emptyDashboard, renderWithIpc } from "@/tests/support/render";

const client = (fields: Partial<Client> & Pick<Client, "id" | "name">): Client => ({
  rateCents: 8500,
  billingName: null,
  address: null,
  email: null,
  netDays: null,
  archived: false,
  hasAvailable: false,
  ...fields,
});
const acme = client({ id: 1, name: "Acme", billingName: "Acme Corp LLC", address: "1 Main St", email: "ap@acme.test", netDays: 15 });
const bolt = client({ id: 2, name: "Bolt", rateCents: 12000 });

function fakeCore({
  projects = [] as Project[],
  entries = [] as TimeEntry[],
  repricing = { seconds: 45000, oldCents: 75000, newCents: 87500 },
  clients: initialClients = [acme, bolt],
  deletion = { projects: 2, entries: 3, seconds: 16200 } as unknown,
} = {}) {
  let clients = initialClients;
  return {
    list_clients: () => clients,
    set_client_archived: ({ id, archived }: Record<string, unknown>) => {
      clients = clients.map((c) => (c.id === id ? { ...c, archived: archived as boolean } : c));
      return clients.find((c) => c.id === id);
    },
    client_deletion: () => {
      if (deletion instanceof Error) throw { kind: "invalid", field: "client", message: deletion.message };
      return deletion;
    },
    delete_client: ({ id }: Record<string, unknown>) => {
      clients = clients.filter((c) => c.id !== id);
      return null;
    },
    get_client: ({ id }: Record<string, unknown>) => clients.find((c) => c.id === id),
    update_client: ({ id, input }: Record<string, unknown>) => {
      const { name, rate } = input as { name: string; rate: string };
      clients = clients.map((c) => (c.id === id ? { ...c, name, rateCents: Math.round(Number(rate) * 100) } : c));
      return clients.find((c) => c.id === id);
    },
    preview_client_rate: () => repricing,
    preview_project_rate: () => repricing,
    list_projects: ({ clientId }: Record<string, unknown>) => projects.filter((p) => p.clientId === clientId),
    get_project: ({ id }: Record<string, unknown>) => projects.find((p) => p.id === id),
    create_project: ({ clientId, input }: Record<string, unknown>) => {
      const { name } = input as { name: string };
      const created = { id: projects.length + 10, clientId: clientId as number, name, rateCents: null, effectiveRateCents: 8500, complete: false };
      projects = [...projects, created];
      return created;
    },
    update_project: ({ id }: Record<string, unknown>) => projects.find((p) => p.id === id),
    set_project_complete: ({ id, complete }: Record<string, unknown>) => {
      projects = projects.map((p) => (p.id === id ? { ...p, complete: complete as boolean } : p));
      return projects.find((p) => p.id === id);
    },
    list_time_entries: ({ clientId }: Record<string, unknown>) => entries.filter((e) => clientId == null || e.clientId === clientId),
    last_used: () => ({ clientId: 1, projectId: null }),
    get_timer: () => null,
    dashboard: emptyDashboard,
    start_timer: () => null,
    create_time_entry: () => entries[0],
    update_time_entry: () => entries[0],
  };
}

const site: Project = { id: 1, clientId: 1, name: "Website", rateCents: 12000, effectiveRateCents: 12000, complete: false };
const old: Project = { id: 2, clientId: 1, name: "Old site", rateCents: null, effectiveRateCents: 8500, complete: true };
const boltApp: Project = { id: 3, clientId: 2, name: "Bolt app", rateCents: null, effectiveRateCents: 12000, complete: false };

const entry = (fields: Partial<TimeEntry> & Pick<TimeEntry, "id">): TimeEntry => ({
  clientId: 1,
  clientName: "Acme",
  projectId: null,
  projectName: null,
  rateCents: 8500,
  date: "2026-10-06",
  seconds: 3600,
  startedAt: null,
  endedAt: null,
  note: null,
  locked: false,
  ...fields,
});

async function openAcme(core: ReturnType<typeof fakeCore>) {
  const rendered = renderWithIpc(<App />, core);
  await rendered.user.click(screen.getByRole("tab", { name: "Patrons" }));
  await rendered.user.click(await screen.findByRole("button", { name: /Acme/ }));
  await screen.findByRole("heading", { name: "Acme" });
  return rendered;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 14, 0));
});
afterEach(() => vi.useRealTimers());

describe("navigation stacks", () => {
  it("pushes a Patron with ◀ Back, and keeps the stack across tab switches", async () => {
    const { user } = await openAcme(fakeCore({ projects: [site] }));

    await user.click(await screen.findByRole("button", { name: /Website/ }));
    expect(await screen.findByRole("heading", { name: "Website" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Log" }));
    expect(screen.getByRole("heading", { name: "Log" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    expect(await screen.findByRole("heading", { name: "Website" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(screen.getByRole("heading", { name: "Patrons" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "◀ Back" })).not.toBeInTheDocument();
  });
});

describe("Retired Patrons", () => {
  const retiredBolt = { ...bolt, archived: true };

  it("lists Active Patrons by default and Retired ones by toggle", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ clients: [acme, retiredBolt] }));
    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    const main = screen.getByRole("main");

    expect(await within(main).findByRole("button", { name: /Acme/ })).toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: /Bolt/ })).not.toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(main).getByRole("button", { name: "Retired" }));
    expect(within(main).getByRole("button", { name: /Bolt/ })).toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: /Acme/ })).not.toBeInTheDocument();
  });

  it("retires a Patron and brings it back", async () => {
    const { user, calls } = await openAcme(fakeCore());

    await user.click(screen.getByRole("button", { name: "Retire" }));
    expect(calls).toContainEqual({ cmd: "set_client_archived", args: { id: 1, archived: true } });
    expect(await screen.findByText("Retired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New Quest" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Un-retire" }));
    expect(calls).toContainEqual({ cmd: "set_client_archived", args: { id: 1, archived: false } });
  });

  it("deletes a Patron after confirming what goes with it", async () => {
    const { user, calls } = await openAcme(fakeCore());

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Patron?" });
    expect(dialog).toHaveTextContent("2 Quests, 3 time entries and 4.5 hours");
    expect(calls.map((c) => c.cmd)).not.toContain("delete_client");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(calls).toContainEqual({ cmd: "delete_client", args: { id: 1 } });
    expect(await screen.findByRole("heading", { name: "Patrons" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Acme/ })).not.toBeInTheDocument();
  });

  it("explains why a Patron with invoiced time can't be deleted", async () => {
    const { user } = await openAcme(fakeCore({ deletion: new Error("This client has time on an invoice; archive it instead") }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("archive it instead");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves Retired Patrons out of the Timer and entry pickers", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ clients: [acme, retiredBolt] }));

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "▶ Start" }));
    const start = screen.getByRole("dialog", { name: "Start Timer" });
    expect(within(within(start).getByLabelText("Patron")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Acme"]);
    await user.click(within(start).getByRole("button", { name: "Cancel" }));

    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New time entry" });
    await vi.waitFor(() => expect(within(within(dialog).getByLabelText("Patron")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Acme"]));
  });

  it("groups Retired Patrons at the bottom of the Log filter", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ clients: [retiredBolt, acme] }));
    await user.click(screen.getByRole("tab", { name: "Log" }));

    const filter = screen.getByLabelText("Patron filter");
    await vi.waitFor(() => expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual(["All Patrons", "Acme", "Bolt"]));
    expect(within(filter).getByRole("group", { name: "Retired" })).toHaveTextContent("Bolt");
  });
});

describe("Patron detail", () => {
  it("shows rate, billing details and Net override", async () => {
    await openAcme(fakeCore());
    const main = screen.getByRole("main");

    expect(main).toHaveTextContent("$85.00 Gold/hr");
    expect(main).toHaveTextContent("Acme Corp LLC");
    expect(main).toHaveTextContent("1 Main St");
    expect(main).toHaveTextContent("ap@acme.test");
    expect(main).toHaveTextContent("Net 15");
  });

  it("confirms a rate change with its repricing effect before saving", async () => {
    const { user, calls } = await openAcme(fakeCore());

    await user.click(screen.getByRole("button", { name: "Edit Patron" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Patron" });
    expect(within(dialog).getByLabelText("Billing name")).toHaveAttribute("placeholder", "Acme");
    await user.clear(within(dialog).getByLabelText("Gold/hr"));
    await user.type(within(dialog).getByLabelText("Gold/hr"), "70");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const confirm = await screen.findByRole("dialog", { name: "Change rate?" });
    expect(confirm).toHaveTextContent("12.5 uninvoiced hours reprice: $750.00 → $875.00");
    expect(calls.some((c) => c.cmd === "update_client")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Reprice" }));

    expect(calls).toContainEqual({
      cmd: "update_client",
      args: { id: 1, input: { name: "Acme", rate: "70", billingName: "Acme Corp LLC", address: "1 Main St", email: "ap@acme.test", netDays: "15" } },
    });
    expect(await screen.findByText("$70.00 Gold/hr")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a save failure on the form when a rate change reprices nothing", async () => {
    const core = fakeCore({ repricing: { seconds: 0, oldCents: 0, newCents: 0 } });
    const { user } = await openAcme({
      ...core,
      update_client: () => {
        throw { kind: "invalid", field: "name", message: "Name taken" };
      },
    });

    await user.click(screen.getByRole("button", { name: "Edit Patron" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Patron" });
    await user.clear(within(dialog).getByLabelText("Gold/hr"));
    await user.type(within(dialog).getByLabelText("Gold/hr"), "70");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Name taken")).toBeInTheDocument();
  });

  it("saves without a confirm when the rate is unchanged", async () => {
    const { user, calls } = await openAcme(fakeCore());

    await user.click(screen.getByRole("button", { name: "Edit Patron" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain("update_client"));
    expect(calls.map((c) => c.cmd)).not.toContain("preview_client_rate");
  });

  it("lists Active or Complete Quests by toggle and creates one", async () => {
    const { user, calls } = await openAcme(fakeCore({ projects: [site, old] }));
    const quests = await screen.findByRole("region", { name: "Quests" });

    expect(await within(quests).findByText("Website")).toBeInTheDocument();
    expect(within(quests).queryByText("Old site")).not.toBeInTheDocument();
    await user.click(within(quests).getByRole("button", { name: "Complete" }));
    expect(within(quests).getByText("Old site")).toBeInTheDocument();
    expect(within(quests).queryByText("Website")).not.toBeInTheDocument();

    await user.click(within(quests).getByRole("button", { name: "Active" }));
    await user.click(within(quests).getByRole("button", { name: "+ New Quest" }));
    const dialog = screen.getByRole("dialog", { name: "New Quest" });
    await user.type(within(dialog).getByLabelText("Name"), "Audit");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(calls).toContainEqual({ cmd: "create_project", args: { clientId: 1, input: { name: "Audit", rate: "" } } });
    expect(await within(quests).findByText("Audit")).toBeInTheDocument();
  });

  it("opens a recent entry in the edit modal", async () => {
    const { user } = await openAcme(fakeCore({ entries: [entry({ id: 5, note: "Kickoff" })] }));

    await user.click(await screen.findByRole("button", { name: /Kickoff/ }));

    expect(screen.getByRole("dialog", { name: "Edit time entry" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
  });
});

describe("Quest detail", () => {
  it("marks a Quest complete and reopens it", async () => {
    const { user, calls } = await openAcme(fakeCore({ projects: [site] }));
    await user.click(await screen.findByRole("button", { name: /Website/ }));
    await screen.findByRole("heading", { name: "Website" });
    expect(screen.getByRole("main")).toHaveTextContent("$120.00 Gold/hr");

    await user.click(screen.getByRole("button", { name: "Mark Quest complete" }));
    expect(calls).toContainEqual({ cmd: "set_project_complete", args: { id: 1, complete: true } });
    expect(await screen.findByText("Quest complete")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(calls).toContainEqual({ cmd: "set_project_complete", args: { id: 1, complete: false } });
  });

  it("confirms a rate change with its repricing effect before saving", async () => {
    const { user, calls } = await openAcme(fakeCore({ projects: [site] }));
    await user.click(await screen.findByRole("button", { name: /Website/ }));
    await user.click(await screen.findByRole("button", { name: "Edit Quest" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Quest" });
    await user.clear(within(dialog).getByLabelText("Gold/hr"));
    await user.type(within(dialog).getByLabelText("Gold/hr"), "140");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const confirm = await screen.findByRole("dialog", { name: "Change rate?" });
    expect(confirm).toHaveTextContent("12.5 uninvoiced hours reprice: $750.00 → $875.00");
    expect(calls.some((c) => c.cmd === "update_project")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Reprice" }));

    expect(calls).toContainEqual({ cmd: "update_project", args: { id: 1, input: { name: "Website", rate: "140" } } });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("saves a Quest without a confirm when the rate is unchanged", async () => {
    const { user, calls } = await openAcme(fakeCore({ projects: [site] }));
    await user.click(await screen.findByRole("button", { name: /Website/ }));
    await user.click(await screen.findByRole("button", { name: "Edit Quest" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain("update_project"));
    expect(calls.map((c) => c.cmd)).not.toContain("preview_project_rate");
  });
});

describe("Quest picker", () => {
  it("offers only the chosen Patron's Active Quests and resets when the Patron changes", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore({ projects: [site, old, boltApp] }));

    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New time entry" });
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Patron")).toHaveValue("1"));
    const picker = within(dialog).getByLabelText("Quest");
    await vi.waitFor(() => expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["No Quest", "Website"]));

    await user.selectOptions(picker, "Website");
    await user.selectOptions(within(dialog).getByLabelText("Patron"), "Bolt");
    await vi.waitFor(() => expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["No Quest", "Bolt app"]));
    expect(picker).toHaveValue("");

    await user.selectOptions(picker, "Bolt app");
    await user.type(within(dialog).getByLabelText("Duration"), "1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(calls).toContainEqual({
      cmd: "create_time_entry",
      args: { input: { clientId: 2, projectId: 3, date: "2026-10-07", span: { mode: "duration", duration: "1" }, note: "" } },
    });
  });

  it("keeps an entry's now-complete Quest when editing it", async () => {
    const { user } = renderWithIpc(
      <App />,
      fakeCore({ projects: [site, old], entries: [entry({ id: 5, projectId: 2, projectName: "Old site" })] }),
    );
    await user.click(screen.getByRole("tab", { name: "Log" }));

    await user.click(await screen.findByRole("button", { name: /Acme · Old site/ }));
    const picker = within(screen.getByRole("dialog")).getByLabelText("Quest");
    await vi.waitFor(() => expect(picker).toHaveValue("2"));
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["No Quest", "Website", "Old site"]);
  });

  it("starts the Timer on a Quest", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore({ projects: [site] }));

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "▶ Start" }));
    const dialog = screen.getByRole("dialog", { name: "Start Timer" });
    const picker = within(dialog).getByLabelText("Quest");
    await vi.waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(picker, "Website");
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(calls).toContainEqual({ cmd: "start_timer", args: { input: { clientId: 1, projectId: 1, note: null } } });
  });
});
