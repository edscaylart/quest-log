import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "@/App";
import { emit, emptyDashboard, renderWithIpc } from "@/tests/support/render";

const broken = (message: string) => () => {
  throw { kind: "database", message };
};

const site = { id: 5, clientId: 1, name: "Website", rateCents: null, effectiveRateCents: 8500, complete: false };
const acme = { id: 1, name: "Acme", rateCents: 8500, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };

async function openAcme(commands: Record<string, (args: Record<string, unknown>) => unknown>) {
  const rendered = renderWithIpc(<App />, commands);
  await rendered.user.click(screen.getByRole("tab", { name: "Patrons" }));
  await rendered.user.click(await screen.findByRole("button", { name: /Acme/ }));
  return rendered;
}

const settings = { name: "", businessName: null, address: null, email: null, taxId: null, paymentInstructions: null, netDays: 30, invoicePrefix: "INV-", nextInvoiceNumber: 1 };
const draft = { id: 7, clientId: 1, clientName: "Acme", state: "draft", period: { start: "2026-09-01", end: "2026-09-30" }, number: null, dueDate: null, overdue: false, seconds: 0, totalCents: 0 };

/** A core where everything loads empty, so a test breaks only the command it cares about. */
const core = () => ({
  list_clients: () => [acme],
  get_client: () => acme,
  list_projects: () => [],
  list_time_entries: () => [],
  list_invoices: () => [],
  get_timer: () => null,
  last_used: () => null,
  dashboard: emptyDashboard,
  get_settings: () => settings,
  data_info: () => ({ path: "/db", lastBackup: { kind: "done", date: "2026-10-07" } }),
});

const inMain = () => within(screen.getByRole("main"));

describe("a failed load shows its error", () => {
  it("on Home's client list", async () => {
    renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });

    expect(await inMain().findByRole("alert")).toHaveTextContent("Database is locked");
  });

  it("on the Log entries", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_time_entries: broken("Entries failed") });
    await user.click(screen.getByRole("tab", { name: "Log" }));
    expect(await inMain().findByRole("alert")).toHaveTextContent("Entries failed");
  });

  it("on the Log's client filter", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });
    await user.click(screen.getByRole("tab", { name: "Log" }));
    expect(await inMain().findByRole("alert")).toHaveTextContent("Database is locked");
  });

  it("on the client list", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });
    await user.click(screen.getByRole("tab", { name: "Patrons" }));

    expect(await inMain().findByRole("alert")).toHaveTextContent("Database is locked");
  });

  it("on a client that won't load", async () => {
    await openAcme({ ...core(), get_client: broken("Client failed") });
    expect(await inMain().findByRole("alert")).toHaveTextContent("Client failed");
  });

  it("on a client's projects and recent entries", async () => {
    await openAcme({ ...core(), list_projects: broken("Projects failed"), list_time_entries: broken("Entries failed") });
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(await inMain().findByRole("alert")).toHaveTextContent("Projects failed");
  });

  it("on a project that won't load", async () => {
    const { user } = await openAcme({ ...core(), list_projects: () => [site], get_project: broken("Project failed") });
    await user.click(await screen.findByRole("button", { name: /Website/ }));
    expect(await inMain().findByRole("alert")).toHaveTextContent("Project failed");
  });

  it("on a project's time entries", async () => {
    const { user } = await openAcme({ ...core(), list_projects: () => [site], get_project: () => site, list_time_entries: broken("Entries failed") });
    await user.click(await screen.findByRole("button", { name: /Website/ }));
    expect(await screen.findByRole("heading", { name: "Website" })).toBeInTheDocument();
    expect(await inMain().findByRole("alert")).toHaveTextContent("Entries failed");
  });

  it("on the invoice list", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_invoices: broken("Invoices failed") });
    await user.click(screen.getByRole("tab", { name: "Scrolls" }));
    expect(await inMain().findByRole("alert")).toHaveTextContent("Invoices failed");
  });

  it("on an invoice that won't load, under its heading", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_invoices: () => [draft], get_invoice: broken("Invoice failed") });
    await user.click(screen.getByRole("tab", { name: "Scrolls" }));
    await user.click(await screen.findByRole("button", { name: /Acme/ }));
    expect(await screen.findByRole("heading", { name: "Scroll" })).toBeInTheDocument();
    expect(inMain().getByRole("alert")).toHaveTextContent("Invoice failed");
  });

  it("on Settings that won't load, under its heading", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), get_settings: broken("Settings failed") });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(inMain().getByRole("alert")).toHaveTextContent("Settings failed");
  });

  it("on Settings' Data section", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), data_info: broken("Data info failed") });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const data = await screen.findByRole("region", { name: "Data" });
    expect(await within(data).findByRole("alert")).toHaveTextContent("Data info failed");
  });

  it("on Settings' export client picker", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const data = await screen.findByRole("region", { name: "Data" });
    expect(await within(data).findByRole("alert")).toHaveTextContent("Database is locked");
  });
});

describe("a failed HUD load shows in the HUD", () => {
  const inHud = () => within(screen.getByRole("banner"));

  it.each([
    ["get_timer", "Timer failed"],
    ["progress", "Progress failed"],
    ["list_clients", "Database is locked"],
  ])("for %s", async (command, message) => {
    renderWithIpc(<App />, { ...core(), [command]: broken(message) });
    expect(await inHud().findByRole("alert")).toHaveTextContent(message);
  });
});

describe("a failed load in a form", () => {
  it("shows the client list error in the time entry modal", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });
    await user.click(screen.getByRole("tab", { name: "Log" }));
    await user.click(screen.getByRole("button", { name: "New time entry" }));
    const dialog = await screen.findByRole("dialog", { name: "New time entry" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Database is locked");
  });

  it("shows the client list error in the new invoice modal", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_clients: broken("Database is locked") });
    await user.click(screen.getByRole("tab", { name: "Scrolls" }));
    await user.click(screen.getByRole("button", { name: "+ New Scroll" }));
    const dialog = await screen.findByRole("dialog", { name: "New Scroll" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Database is locked");
  });

  it("shows the project list error on the project picker", async () => {
    const { user } = renderWithIpc(<App />, { ...core(), list_projects: broken("Projects failed") });
    await user.click(await screen.findByRole("button", { name: "▶ Start" }));
    const dialog = await screen.findByRole("dialog", { name: "Start Timer" });
    expect(await within(dialog).findByText("Projects failed")).toBeInTheDocument();
  });

  it("stays quiet when the last-used client won't load, and still saves", async () => {
    const { user, calls } = renderWithIpc(<App />, { ...core(), last_used: broken("Last used failed"), start_timer: () => null, create_time_entry: () => null });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "▶ Start" }));
    const start = await screen.findByRole("dialog", { name: "Start Timer" });
    expect(within(start).queryByText("Last used failed")).not.toBeInTheDocument();
    await user.click(within(start).getByRole("button", { name: /Start/ }));
    expect(calls.map((c) => c.cmd)).toContain("start_timer");

    await user.click(screen.getByRole("tab", { name: "Log" }));
    await user.click(screen.getByRole("button", { name: "New time entry" }));
    const entry = await screen.findByRole("dialog", { name: "New time entry" });
    await vi.waitFor(() => expect(within(entry).getByRole("button", { name: "Save" })).toBeEnabled());
    expect(within(entry).queryByText("Last used failed")).not.toBeInTheDocument();
    await user.type(within(entry).getByLabelText("Duration"), "1:00");
    await user.click(within(entry).getByRole("button", { name: "Save" }));
    expect(calls.find((c) => c.cmd === "create_time_entry")?.args).toMatchObject({ input: { clientId: acme.id } });
  });
});

describe("a load that fails then succeeds", () => {
  it("clears its error on the next reload", async () => {
    let fail = true;
    const { user } = renderWithIpc(<App />, {
      ...core(),
      list_invoices: () => {
        if (fail) throw { kind: "database", message: "Invoices failed" };
        return [];
      },
    });
    await user.click(screen.getByRole("tab", { name: "Scrolls" }));
    expect(await inMain().findByRole("alert")).toHaveTextContent("Invoices failed");

    fail = false;
    await emit("timer-changed", null);

    expect(await inMain().findByText("No Scrolls yet.")).toBeInTheDocument();
    expect(inMain().queryByRole("alert")).not.toBeInTheDocument();
  });
});
