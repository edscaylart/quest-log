import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "@/App";
import type { Client, PeriodInput, Settings } from "@/api";
import { emptyDashboard, renderWithIpc } from "@/tests/support/render";

const defaults: Settings = {
  name: "",
  businessName: null,
  address: null,
  email: null,
  taxId: null,
  paymentInstructions: null,
  netDays: 30,
  invoicePrefix: "INV-",
  nextInvoiceNumber: 1,
};

function fakeCore(settings = defaults) {
  return {
    list_clients: () => [],
    list_time_entries: () => [],
    get_timer: () => null,
    dashboard: emptyDashboard,
    get_settings: () => settings,
    data_info: () => ({ path: "/Users/ed/Library/Application Support/quest-log/quest-log.db", lastBackup: { kind: "done", date: "2026-10-07" } }),
    update_settings: ({ input }: Record<string, unknown>) => {
      const i = input as Record<string, string>;
      settings = { ...settings, name: i.name, email: i.email || null, netDays: Number(i.netDays), nextInvoiceNumber: Number(i.nextInvoiceNumber) };
      return settings;
    },
  };
}

describe("Settings", () => {
  it("opens from the HUD gear as a pushed screen with Back", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Net days")).toHaveValue("30");
    expect(screen.getByLabelText("Invoice prefix")).toHaveValue("INV-");
    expect(screen.getByLabelText("Next invoice number")).toHaveValue("1");

    await user.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("opens with ⌘, inside the current tab", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());
    await user.click(screen.getByRole("tab", { name: "Log" }));

    await user.keyboard("{Meta>},{/Meta}");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(screen.getByRole("heading", { name: "Log" })).toBeInTheDocument();
  });

  it("saves every field as typed", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());
    await user.keyboard("{Meta>},{/Meta}");

    await user.type(await screen.findByLabelText("Name"), "Ed Souza");
    await user.type(screen.getByLabelText("Business name"), "Souza Dev");
    await user.type(screen.getByLabelText("Address"), "1 Main St");
    await user.type(screen.getByLabelText("Email"), "ed@example.com");
    await user.type(screen.getByLabelText("Tax ID"), "12-3456789");
    await user.type(screen.getByLabelText("Payment instructions"), "Wire");
    await user.clear(screen.getByLabelText("Net days"));
    await user.type(screen.getByLabelText("Net days"), "15");
    await user.clear(screen.getByLabelText("Next invoice number"));
    await user.type(screen.getByLabelText("Next invoice number"), "42");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({
      cmd: "update_settings",
      args: {
        input: {
          name: "Ed Souza",
          businessName: "Souza Dev",
          address: "1 Main St",
          email: "ed@example.com",
          taxId: "12-3456789",
          paymentInstructions: "Wire",
          netDays: "15",
          invoicePrefix: "INV-",
          nextInvoiceNumber: "42",
        },
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("shows the core's validation error on its field", async () => {
    const { user } = renderWithIpc(<App />, {
      ...fakeCore(),
      update_settings: () => {
        throw { kind: "invalid", field: "name", message: "Name is required" };
      },
    });
    await user.keyboard("{Meta>},{/Meta}");

    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Settings → Data", () => {
  async function openData(commands: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    const rendered = renderWithIpc(<App />, { ...fakeCore(), ...commands });
    await rendered.user.keyboard("{Meta>},{/Meta}");
    return { ...rendered, data: await screen.findByRole("region", { name: "Data" }) };
  }

  it("shows where the database lives and reveals it in Finder", async () => {
    const { user, calls, data } = await openData({ reveal_database: () => null });

    expect(await within(data).findByText("/Users/ed/Library/Application Support/quest-log/quest-log.db")).toBeInTheDocument();
    await user.click(within(data).getByRole("button", { name: "Reveal in Finder" }));

    expect(calls.map((c) => c.cmd)).toContain("reveal_database");
  });

  it("shows the last backup", async () => {
    const { data } = await openData();
    expect(await within(data).findByText("Last backup: Oct 7, 2026")).toBeInTheDocument();
  });

  it("shows a failed backup", async () => {
    const { data } = await openData({
      data_info: () => ({ path: "/db", lastBackup: { kind: "failed", date: "2026-10-07", message: "disk full" } }),
    });
    expect(await within(data).findByText("Last backup: failed Oct 7, 2026 (disk full)")).toBeInTheDocument();
  });

  it("backs up now to the file the user picks", async () => {
    const { user, calls, data } = await openData({ "plugin:dialog|save": () => "/Volumes/USB/quest-log.db", back_up_now: () => null });

    await user.click(within(data).getByRole("button", { name: "Back up now" }));

    await waitFor(() => expect(calls).toContainEqual({ cmd: "back_up_now", args: { path: "/Volumes/USB/quest-log.db" } }));
    expect(await within(data).findByRole("status")).toHaveTextContent("Backed up");
  });

  it("writes nothing when the save panel is cancelled", async () => {
    const { user, calls, data } = await openData({ "plugin:dialog|save": () => null });

    await user.click(within(data).getByRole("button", { name: "Back up now" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "plugin:dialog|save")).toBe(true));
    expect(calls.some((c) => c.cmd === "back_up_now")).toBe(false);
  });

  it("restores a backup after confirming its date", async () => {
    const { user, calls, data } = await openData({
      "plugin:dialog|open": () => "/Volumes/USB/old.db",
      inspect_backup: () => ({ date: "2026-09-30" }),
      restore_backup: () => null,
    });

    await user.click(within(data).getByRole("button", { name: "Restore from backup…" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore backup?" });
    expect(within(dialog).getByText("Replace all data with backup from Sep 30, 2026?")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "restore_backup")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(calls).toContainEqual({ cmd: "restore_backup", args: { path: "/Volumes/USB/old.db" } }));
  });

  it("explains why a backup can't be restored", async () => {
    const { user, calls, data } = await openData({
      "plugin:dialog|open": () => "/Volumes/USB/new.db",
      inspect_backup: () => {
        throw { kind: "invalid", field: "file", message: "This backup is from a newer Quest Log — update first." };
      },
    });

    await user.click(within(data).getByRole("button", { name: "Restore from backup…" }));

    expect(await within(data).findByText("This backup is from a newer Quest Log — update first.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "restore_backup")).toBe(false);
  });
});

describe("Settings → Data → CSV export", () => {
  const acme: Client = { id: 1, name: "Acme", rateCents: 10000, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };
  const old: Client = { ...acme, id: 2, name: "Old Co", archived: true };

  beforeEach(() => localStorage.clear());

  async function openData(commands: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    const rendered = renderWithIpc(<App />, {
      ...fakeCore(),
      list_clients: () => [acme, old],
      // Home re-saves the custom days it shows; echo them back as core does at offset 0.
      dashboard: ({ input }) => {
        const { start, end } = input as PeriodInput;
        return start && end ? { ...emptyDashboard(), period: { start, end } } : emptyDashboard();
      },
      export_csv: () => "Date\n",
      "plugin:dialog|save": () => "/Users/ed/time.csv",
      "plugin:fs|write_file": () => null,
      ...commands,
    });
    await rendered.user.keyboard("{Meta>},{/Meta}");
    return { ...rendered, data: await screen.findByRole("region", { name: "Data" }) };
  }

  it("defaults to the Dashboard's period and exports every Patron to the picked file", async () => {
    localStorage.setItem("home.period", JSON.stringify({ preset: "2w", range: null }));
    const { user, calls, data } = await openData();

    expect(within(data).getByLabelText("Export period")).toHaveValue("2w");
    await user.click(within(data).getByRole("button", { name: "Export CSV…" }));

    await waitFor(() =>
      expect(calls).toContainEqual({ cmd: "export_csv", args: { input: { preset: "2w", offset: 0, start: null, end: null }, clientId: null } }),
    );
    expect(calls.some((c) => c.cmd === "plugin:fs|write_file")).toBe(true);
    expect(await within(data).findByRole("status")).toHaveTextContent("Exported");
  });

  it("exports a custom range for one Patron, retired ones included", async () => {
    localStorage.setItem("home.period", JSON.stringify({ preset: "custom", range: { start: "2026-09-01", end: "2026-09-15" } }));
    const { user, calls, data } = await openData();

    expect(within(data).getByLabelText("From")).toHaveValue("2026-09-01");
    expect(within(data).getByLabelText("To")).toHaveValue("2026-09-15");
    await user.selectOptions(await within(data).findByLabelText("Export Patron"), "Old Co (Retired)");
    await user.click(within(data).getByRole("button", { name: "Export CSV…" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        cmd: "export_csv",
        args: { input: { preset: "custom", offset: 0, start: "2026-09-01", end: "2026-09-15" }, clientId: 2 },
      }),
    );
  });

  it("exports nothing when the save panel is cancelled", async () => {
    const { user, calls, data } = await openData({ "plugin:dialog|save": () => null });

    await user.click(within(data).getByRole("button", { name: "Export CSV…" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "plugin:dialog|save")).toBe(true));
    expect(calls.some((c) => c.cmd === "export_csv")).toBe(false);
  });

  it("shows why an export failed", async () => {
    const { user, data } = await openData({
      export_csv: () => {
        throw { kind: "invalid", field: "start", message: "Date is required" };
      },
    });

    await user.click(within(data).getByRole("button", { name: "Export CSV…" }));

    expect(await within(data).findByText("Date is required")).toBeInTheDocument();
  });
});
