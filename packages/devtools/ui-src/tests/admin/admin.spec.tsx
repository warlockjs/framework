import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DevtoolsAuditEntry } from "@contracts";
import { App } from "@/app/App";
import { account, instanceInfo, mockApi, sessionView } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());

const other = account({ id: "a2", email: "viewer@example.com", role: "viewer" });
const base = {
  "api/auth/session": { body: sessionView() },
  "api/panels": { body: [{ id: "requests", title: "Requests", type: "built-in", shareable: false }] },
  "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
  "api/admin/users": { body: { accounts: [account(), other], invites: [] } },
} as Record<string, { status?: number; body?: unknown }>;

describe("admin users", () => {
  it("creates an invite and shows the link once with the expiry", async () => {
    window.location.hash = "#/admin/users";
    const api = mockApi({
      ...base,
      "POST api/admin/invites": {
        body: {
          token: "tok-abc",
          invite: {
            id: "i1",
            email: "new@example.com",
            role: "viewer",
            createdAt: 1,
            expiresAt: Date.now() + 86_400_000,
            createdBy: "a1",
            usedAt: null,
          },
        },
      },
    });

    render(<App />);
    await userEvent.type(await screen.findByLabelText("Email"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create invite" }));

    const link = await screen.findByTestId("invite-link");

    expect(link).toHaveTextContent(
      `${window.location.origin}${window.location.pathname}#/invite/tok-abc`,
    );
    expect(screen.getByText(/Invite for/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/admin/invites")?.body).toEqual({
      email: "new@example.com",
      role: "viewer",
    });

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
  });

  it("changes a role, removes and resets accounts only after a confirm, and not for yourself", async () => {
    window.location.hash = "#/admin/users";
    const api = mockApi({
      ...base,
      "PATCH api/admin/users/a2": { body: other },
      "DELETE api/admin/users/a2": { status: 204 },
      "POST api/admin/users/a2/reset-mfa": { status: 204 },
      "POST api/admin/users/a2/sign-out": { status: 204 },
    });

    render(<App />);
    await screen.findByText("viewer@example.com");

    // Your own row has no actions.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);

    for (const [button, method, path] of [
      ["Make admin", "PATCH", "api/admin/users/a2"],
      ["Reset second factor", "POST", "api/admin/users/a2/reset-mfa"],
      ["Sign out everywhere", "POST", "api/admin/users/a2/sign-out"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: button }));
      expect(api.calls.some((call) => call.path === path && call.method === method)).toBe(false);

      const dialog = await screen.findByRole("dialog");

      await userEvent.click(
        within(dialog)
          .getAllByRole("button")
          .find((item) => item.textContent !== "Cancel" && item.textContent !== "Close")!,
      );
      await waitFor(() =>
        expect(api.calls.some((call) => call.path === path && call.method === method)).toBe(true),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "DELETE" && call.path === "api/admin/users/a2"),
      ).toBe(true),
    );
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ role: "admin" });
  });

  it("revokes a pending invite after a confirm", async () => {
    window.location.hash = "#/admin/users";
    const api = mockApi({
      ...base,
      "api/admin/users": {
        body: {
          accounts: [account()],
          invites: [
            {
              id: "i9",
              email: "wait@example.com",
              role: "viewer",
              createdAt: 1,
              expiresAt: Date.now() + 1000,
              createdBy: "a1",
              usedAt: null,
            },
          ],
        },
      },
      "DELETE api/admin/invites/i9": { status: 204 },
    });

    render(<App />);
    await screen.findByText("wait@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "DELETE" && call.path === "api/admin/invites/i9"),
      ).toBe(true),
    );
  });

  it("is closed to viewers with a note that says what to do", async () => {
    window.location.hash = "#/admin/users";
    mockApi({ ...base, "api/auth/session": { body: sessionView({ role: "viewer" }) } });
    render(<App />);

    expect(await screen.findByText("This page is for admins.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create invite" })).not.toBeInTheDocument();
  });
});

function entries(count: number, startAt: number): DevtoolsAuditEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${startAt - index}`,
    at: startAt - index,
    type: "login.failed" as const,
    accountId: null,
    email: `user${startAt - index}@example.com`,
    ip: "10.0.0.1",
    userAgent: null,
    detail: {},
    ref: `REF${startAt - index}`,
  }));
}

describe("admin audit", () => {
  it("filters by type and pages back with before", async () => {
    window.location.hash = "#/admin/audit";

    const api = mockApi({
      ...base,
      "api/admin/audit": (request) => {
        const params = new URL(request.url, "http://x/").searchParams;

        if (params.get("before")) return { body: entries(3, 1000) };
        if (params.get("type") === "mfa.failed") return { body: [] };

        return { body: entries(50, 5000) };
      },
    });

    render(<App />);
    expect(await screen.findByText("user5000@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load older" }));

    expect(await screen.findByText("user1000@example.com")).toBeInTheDocument();
    expect(screen.getByText("user5000@example.com")).toBeInTheDocument();
    expect(api.calls.some((call) => call.url.includes("before=4951"))).toBe(true);
    // A short page ends the list.
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Event type"), "mfa.failed");

    expect(await screen.findByText("No audit entries match.")).toBeInTheDocument();
    expect(api.calls.some((call) => call.url.includes("type=mfa.failed"))).toBe(true);
  });

  it("shows a load error with its reference", async () => {
    window.location.hash = "#/admin/audit";
    mockApi({
      ...base,
      "api/admin/audit": {
        status: 500,
        body: {
          error: "The audit log could not be read. Try again.",
          code: "server.error",
          ref: "AUD00001",
        },
      },
    });
    render(<App />);

    expect(await screen.findByText(/audit log could not be read/)).toBeInTheDocument();
    expect(screen.getByText("Reference: AUD00001")).toBeInTheDocument();
  });
});

describe("admin settings", () => {
  it("needs the word disable, then shows how to open the dashboard again", async () => {
    window.location.hash = "#/admin/settings";
    const api = mockApi({ ...base, "POST api/admin/disable": { status: 204 } });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Disable the dashboard" }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/warlock devtools:enable/)).toBeInTheDocument();
    expect(within(dialog).getByText(/DEVTOOLS_PATH/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "Disable the dashboard" });

    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type/), "disabl");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type/), "e");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(await screen.findByText("The dashboard is turned off")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/admin/disable")?.body).toEqual({
      confirm: "disable",
    });
  });

  it("keeps the dialog open and shows the error when disabling fails", async () => {
    window.location.hash = "#/admin/settings";
    mockApi({
      ...base,
      "POST api/admin/disable": {
        status: 403,
        body: {
          error: "Only admins can turn the dashboard off. Sign in as an admin.",
          code: "role.forbidden",
          ref: "DIS00001",
        },
      },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Disable the dashboard" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText(/Type/), "disable");
    await userEvent.click(within(dialog).getByRole("button", { name: "Disable the dashboard" }));

    expect(
      await within(dialog).findByText(/Only admins can turn the dashboard off/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Reference: DIS00001")).toBeInTheDocument();
  });
});
