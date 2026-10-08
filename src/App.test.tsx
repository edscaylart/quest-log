import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Client } from "./api";
import { renderWithIpc } from "./test/render";

function fakeCore(clients: Client[] = []) {
  return {
    list_clients: () => clients,
    list_time_entries: () => [],
    get_timer: () => null,
    create_client: ({ input }: Record<string, unknown>) => {
      const { name, rate } = input as { name: string; rate: string };
      const client = { id: clients.length + 1, name, rateCents: Math.round(Number(rate) * 100) };
      clients = [...clients, client];
      return client;
    },
  };
}

describe("navigation", () => {
  it("opens on Home and switches tabs by click and by ⌘1–4", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    expect(screen.getByRole("heading", { name: "Patrons" })).toBeInTheDocument();

    await user.keyboard("{Meta>}2{/Meta}");
    expect(screen.getByRole("heading", { name: "Log" })).toBeInTheDocument();
    await user.keyboard("{Meta>}4{/Meta}");
    expect(screen.getByRole("heading", { name: "Scrolls" })).toBeInTheDocument();
    await user.keyboard("{Meta>}1{/Meta}");
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });
});

describe("Clients", () => {
  it("lists Patrons with their Gold/hr", async () => {
    const { user } = renderWithIpc(<App />, fakeCore([{ id: 1, name: "Acme", rateCents: 8550 }]));

    await user.click(screen.getByRole("tab", { name: "Patrons" }));

    const row = await screen.findByRole("listitem");
    expect(row).toHaveTextContent("Acme");
    expect(row).toHaveTextContent("$85.50 Gold/hr");
  });

  it("creates a Patron through the modal", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());
    await user.click(screen.getByRole("tab", { name: "Patrons" }));

    await user.click(await screen.findByRole("button", { name: "+ New Patron" }));
    const dialog = screen.getByRole("dialog", { name: "New Patron" });
    await user.type(within(dialog).getByLabelText("Name"), "Acme");
    await user.type(within(dialog).getByLabelText("Gold/hr"), "85");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(calls).toContainEqual({ cmd: "create_client", args: { input: { name: "Acme", rate: "85" } } });
    expect(await screen.findByRole("listitem")).toHaveTextContent("Acme");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the core's validation error and keeps the modal open", async () => {
    const { user } = renderWithIpc(<App />, {
      ...fakeCore(),
      create_client: () => {
        throw { kind: "invalid", field: "rate", message: "Rate is required" };
      },
    });
    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    await user.click(await screen.findByRole("button", { name: "+ New Patron" }));
    const dialog = screen.getByRole("dialog", { name: "New Patron" });

    await user.type(within(dialog).getByLabelText("Name"), "Acme");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await within(dialog).findByText("Rate is required")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Gold/hr")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a non-core failure instead of swallowing it", async () => {
    const { user } = renderWithIpc(<App />, {
      ...fakeCore(),
      create_client: () => {
        throw "invalid args `input` for command `create_client`";
      },
    });
    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    await user.click(await screen.findByRole("button", { name: "+ New Patron" }));
    const dialog = screen.getByRole("dialog", { name: "New Patron" });

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await within(dialog).findByText(/invalid args/)).toBeInTheDocument();
  });

  it("closes the modal on Esc", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());
    await user.click(screen.getByRole("tab", { name: "Patrons" }));
    await user.click(await screen.findByRole("button", { name: "+ New Patron" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
