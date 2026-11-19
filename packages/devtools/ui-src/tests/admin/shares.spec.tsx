import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DevtoolsShareList, DevtoolsShareView } from "@contracts";
import { App } from "@/app/App";
import { sharePanelOf } from "@/lib/route";
import { instanceInfo, mockApi, sessionView } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());

const NOW = Date.now();

function share(overrides: Partial<DevtoolsShareView> = {}): DevtoolsShareView {
  return {
    id: "s1",
    panel: "grimoire",
    label: "Quarterly review",
    createdBy: "admin@example.com",
    createdAt: NOW - 3_600_000,
    expiresAt: NOW + 5 * 86_400_000,
    revokedAt: null,
    lastUsedAt: NOW - 60_000,
    uses: 4,
    status: "active",
    ...overrides,
  };
}

function list(shares: DevtoolsShareView[], overrides: Partial<DevtoolsShareList> = {}) {
  return {
    enabled: true,
    maxDays: 30,
    panels: [{ id: "grimoire", title: "Grimoire" }],
    shares,
    ...overrides,
  } satisfies DevtoolsShareList;
}

const base = (shares: DevtoolsShareView[], session = sessionView({ share: { enabled: true } })) =>
  ({
    "api/auth/session": { body: session },
    "api/panels": {
      body: [{ id: "grimoire", title: "Grimoire", type: "package", shareable: true }],
    },
    "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
    "api/admin/shares": { body: list(shares) },
  }) as Record<string, { status?: number; body?: unknown }>;

describe("admin share links", () => {
  it("lists the links with their status, and offers revoke only for active ones", async () => {
    window.location.hash = "#/admin/shares";
    mockApi(
      base([
        share(),
        share({ id: "s2", label: "Old link", status: "expired", expiresAt: NOW - 1000 }),
        share({ id: "s3", label: "Pulled", status: "revoked", revokedAt: NOW - 500 }),
      ]),
    );

    render(<App />);

    const rows = await screen.findAllByRole("row");
    const body = rows.slice(1);

    expect(within(body[0]!).getByText("Quarterly review")).toBeInTheDocument();
    expect(within(body[0]!).getByText("active")).toBeInTheDocument();
    expect(within(body[0]!).getByText("Grimoire")).toBeInTheDocument();
    expect(within(body[1]!).getByText("expired")).toBeInTheDocument();
    expect(within(body[2]!).getByText("revoked")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("creates a link from the dialog and shows the URL once, with a copy button and the note", async () => {
    window.location.hash = "#/admin/shares";

    const url = "https://app.example.com/ops-7f3k2q9x/#/share/tok-abc";
    const api = mockApi({
      ...base([]),
      "POST api/admin/shares": { status: 201, body: { share: share({ id: "new" }), url } },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Create a link" }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Days until it expires (1 to 30)")).toHaveValue(7);

    await userEvent.type(within(dialog).getByLabelText("Label"), "Board meeting");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));

    expect(await screen.findByTestId("share-link")).toHaveTextContent(url);
    expect(screen.getByText(/shown only now/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      panel: "grimoire",
      label: "Board meeting",
      days: 7,
    });

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByTestId("share-link")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the server's message when creating fails", async () => {
    window.location.hash = "#/admin/shares";
    mockApi({
      ...base([]),
      "POST api/admin/shares": {
        status: 422,
        body: {
          error: "Some fields are missing or not valid.",
          code: "input.invalid",
          ref: "AB12CD34",
        },
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Create a link" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText("Label"), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));

    expect(
      await within(dialog).findByText(/Some fields are missing or not valid/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/AB12CD34/)).toBeInTheDocument();
  });

  it("preselects the panel named in the address", async () => {
    window.location.hash = "#/admin/shares?panel=other";
    mockApi({
      ...base([]),
      "api/admin/shares": {
        body: list([], {
          panels: [
            { id: "grimoire", title: "Grimoire" },
            { id: "other", title: "Other" },
          ],
        }),
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Create a link" }));

    expect(await screen.findByLabelText("Panel")).toHaveValue("other");
    expect(sharePanelOf("#/admin/shares?panel=other")).toBe("other");
    expect(sharePanelOf("#/admin/shares")).toBeNull();
  });

  it("revokes one link only after a confirm", async () => {
    window.location.hash = "#/admin/shares";

    const api = mockApi({ ...base([share()]), "DELETE api/admin/shares/s1": { status: 204 } });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Revoke the link "Quarterly review"/)).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "DELETE" && call.path === "api/admin/shares/s1"),
      ).toBe(true),
    );
  });

  it("revokes all links only after typing the confirmation text", async () => {
    window.location.hash = "#/admin/shares";

    const api = mockApi({
      ...base([share(), share({ id: "s2" })]),
      "POST api/admin/shares/revoke-all": { body: { revoked: 2 } },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke all links" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Revoke all" });

    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByRole("textbox"), "revoke all");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === "api/admin/shares/revoke-all")).toBe(true),
    );
  });

  it("says no panel can be shared when none declares a shared view", async () => {
    window.location.hash = "#/admin/shares";
    mockApi({ ...base([]), "api/admin/shares": { body: list([], { panels: [] }) } });

    render(<App />);

    expect(await screen.findByText("No panel can be shared.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a link" })).toBeDisabled();
  });

  it("shows the menu entry to admins only when sharing is on", async () => {
    window.location.hash = "#/account";
    mockApi({
      ...base([]),
      "api/account": { body: sessionView().account },
      "api/account/sessions": { body: [] },
    });

    const { unmount } = render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Admin" }));
    expect(await screen.findByRole("menuitem", { name: "Share links" })).toBeInTheDocument();
    unmount();

    mockApi({
      ...base([], sessionView({ share: { enabled: false } })),
      "api/account": { body: sessionView().account },
      "api/account/sessions": { body: [] },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Admin" }));
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Share links" })).not.toBeInTheDocument();
  });

  it("does not show the page when sharing is off", async () => {
    window.location.hash = "#/admin/shares";
    mockApi(base([], sessionView({ share: { enabled: false } })));

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Disable the dashboard" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Share links" })).not.toBeInTheDocument();
  });
});
