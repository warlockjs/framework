import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/app/App";
import { account, instanceInfo, mockApi, sessionView } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(async () => ({ id: "new-key", type: "public-key" })),
  startAuthentication: vi.fn(async () => ({ id: "cred-1", type: "public-key" })),
}));

const sessions = [
  {
    id: "s1",
    current: true,
    createdAt: 1,
    lastSeenAt: Date.now(),
    expiresAt: 9,
    ip: "10.0.0.1",
    userAgent: "Firefox",
  },
  {
    id: "s2",
    current: false,
    createdAt: 1,
    lastSeenAt: Date.now() - 600_000,
    expiresAt: 9,
    ip: "10.0.0.2",
    userAgent: "Chrome",
  },
];

function routes(extra: Record<string, never | object> = {}) {
  return {
    "api/auth/session": { body: sessionView() },
    "api/panels": { body: [{ id: "requests", title: "Requests", type: "built-in", shareable: false }] },
    "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
    "api/account": { body: account() },
    "api/account/sessions": { body: sessions },
    ...extra,
  } as Record<string, { status?: number; body?: unknown }>;
}

describe("account page", () => {
  it("lists the sessions, marks the current one and revokes another after a confirm", async () => {
    window.location.hash = "#/account";
    const api = mockApi(routes({ "DELETE api/account/sessions/s2": { status: 204 } }));

    render(<App />);

    expect(await screen.findByText("This session")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.method === "DELETE" && call.path === "api/account/sessions/s2",
        ),
      ).toBe(true),
    );
    expect(api.calls.find((call) => call.method === "DELETE")?.headers.get("X-Devtools-Csrf")).toBe(
      "csrf-1",
    );
  });

  it("changes the password with the current one and shows the server's error when it fails", async () => {
    window.location.hash = "#/account";
    const api = mockApi(
      routes({
        "POST api/account/password": {
          status: 422,
          body: {
            error: "The current password is not right. Type it again.",
            code: "auth.wrong-current-password",
            ref: "PW000001",
          },
        },
      }),
    );

    render(<App />);
    await userEvent.type(await screen.findByLabelText("Current password"), "old-password-1");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-123");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "new-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText(/current password is not right/)).toBeInTheDocument();
    expect(screen.getByText("Reference: PW000001")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/account/password")?.body).toEqual({
      current: "old-password-1",
      password: "new-password-123",
    });
  });

  it("removes the authenticator app with the current password and keeps the dialog open on failure", async () => {
    window.location.hash = "#/account";
    const api = mockApi(
      routes({
        "DELETE api/account/totp": {
          status: 409,
          body: {
            error: "This is your only second factor. Add a passkey first.",
            code: "account.last-factor",
            ref: "LAST0001",
          },
        },
      }),
    );
    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove the authenticator app" }),
    );

    const dialog = await screen.findByRole("dialog");

    // Nothing is sent until the current password is typed.
    expect(within(dialog).getByRole("button", { name: "Remove" })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Current password"), "my-password-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByText(/This is your only second factor/)).toBeInTheDocument();
    expect(within(dialog).getByText("Reference: LAST0001")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/account/totp")?.body).toEqual({
      current: "my-password-1",
    });
  });

  it("adds an authenticator app from the account page with the code and the current password", async () => {
    window.location.hash = "#/account";
    const api = mockApi(
      routes({
        "api/account": {
          body: account({ twoFactor: { totp: false, passkeys: [], recoveryCodesLeft: 0 } }),
        },
        "POST api/account/totp/start": {
          body: {
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP",
            issuer: "Warlock monitor",
            account: "admin@example.com",
          },
        },
        "POST api/account/totp/confirm": {
          body: { stage: "active", csrf: null, recoveryCodes: ["r1-aaaa"] },
        },
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Add an authenticator app" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up an authenticator app" }),
    );
    await userEvent.type(await screen.findByLabelText("Code from the app"), "123456");
    await userEvent.type(screen.getAllByLabelText("Current password").at(-1)!, "my-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Confirm the code" }));

    expect(await screen.findByText("r1-aaaa")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/account/totp/confirm")?.body).toEqual({
      code: "123456",
      current: "my-password-1",
    });
  });

  it("adds a passkey after asking for the current password", async () => {
    window.location.hash = "#/account";
    const api = mockApi(
      routes({
        "POST api/account/passkey/options": { body: { challenge: "c" } },
        "POST api/account/passkey/verify": { body: { stage: "active", csrf: null } },
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText("Current password"), "my-password-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls.find((call) => call.path === "api/account/passkey/verify")?.body).toEqual({
      purpose: "register",
      response: { id: "new-key", type: "public-key" },
      current: "my-password-1",
    });
  });

  it("removes a passkey with the current password", async () => {
    window.location.hash = "#/account";
    const passkey = { id: "cred-1", name: "Laptop", createdAt: 1, lastUsedAt: null };
    const api = mockApi(
      routes({
        "api/account": {
          body: account({ twoFactor: { totp: true, passkeys: [passkey], recoveryCodesLeft: 8 } }),
        },
        "DELETE api/account/passkeys/cred-1": { status: 204 },
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText("Current password"), "my-password-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.path === "api/account/passkeys/cred-1")?.body).toEqual({
        current: "my-password-1",
      }),
    );
  });

  it("makes new recovery codes with a passkey when the account has no authenticator app", async () => {
    window.location.hash = "#/account";
    const passkey = { id: "cred-1", name: "Laptop", createdAt: 1, lastUsedAt: null };
    const api = mockApi(
      routes({
        "api/account": {
          body: account({ twoFactor: { totp: false, passkeys: [passkey], recoveryCodesLeft: 3 } }),
        },
        "POST api/account/passkey/options": { body: { challenge: "c" } },
        "POST api/account/passkey/verify": { body: { stage: "active", csrf: null } },
        "POST api/account/recovery-codes": { body: { codes: ["new1-aaaa"] } },
      }),
    );

    render(<App />);

    expect(await screen.findByText(/3 left/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Current code from your authenticator app"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Make new recovery codes with a passkey" }),
    );

    expect(await screen.findByText("new1-aaaa")).toBeInTheDocument();
    expect(
      api.calls.filter((call) => call.method === "POST").map((call) => [call.path, call.body]),
    ).toEqual([
      ["api/account/passkey/options", { purpose: "login" }],
      [
        "api/account/passkey/verify",
        { purpose: "login", response: { id: "cred-1", type: "public-key" } },
      ],
      ["api/account/recovery-codes", {}],
    ]);
  });

  it("regenerates recovery codes with a current code and shows them once", async () => {
    window.location.hash = "#/account";
    const api = mockApi(
      routes({
        "POST api/account/recovery-codes": { body: { codes: ["new1-aaaa", "new2-bbbb"] } },
      }),
    );

    render(<App />);
    await userEvent.type(
      await screen.findByLabelText("Current code from your authenticator app"),
      "654321",
    );
    await userEvent.click(screen.getByRole("button", { name: "Make new recovery codes" }));

    expect(await screen.findByText("new1-aaaa")).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/account/recovery-codes")?.body).toEqual({
      code: "654321",
    });
  });

  it("shows an account load error with its reference", async () => {
    window.location.hash = "#/account";
    mockApi(
      routes({
        "api/account": {
          status: 500,
          body: {
            error: "The account could not be read. Reload the page.",
            code: "server.error",
            ref: "ACC00001",
          },
        },
      }),
    );
    render(<App />);

    expect(await screen.findByText(/account could not be read/)).toBeInTheDocument();
    expect(screen.getByText("Reference: ACC00001")).toBeInTheDocument();
  });
});
