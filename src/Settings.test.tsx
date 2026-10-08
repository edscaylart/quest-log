import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Settings } from "./api";
import { emptyDashboard, renderWithIpc } from "./test/render";

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
