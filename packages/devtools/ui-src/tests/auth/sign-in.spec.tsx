import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/app/App";
import { developmentSession, instanceInfo, mockApi, sessionView, signedOut } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());

const startRegistration = vi.fn();
const startAuthentication = vi.fn();

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => startRegistration(...args),
  startAuthentication: (...args: unknown[]) => startAuthentication(...args),
}));

const shellRoutes = {
  "api/panels": { body: [{ id: "requests", title: "Requests", type: "built-in" }] },
  "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
};

async function fillLogin() {
  await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("sign-in", () => {
  it("shows the login form when signed out and signs in", async () => {
    let stage: "signed-out" | "active" = "signed-out";
    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: stage === "active" ? sessionView() : signedOut }),
      "POST api/auth/login": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "csrf-new" } };
      },
    });

    render(<App />);
    await fillLogin();

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/auth/login")?.body).toEqual({
      email: "admin@example.com",
      password: "correct horse battery",
    });
  });

  it("shows the server's message and reference on a failed login and keeps the form", async () => {
    mockApi({
      "api/auth/session": { body: signedOut },
      "POST api/auth/login": {
        status: 401,
        body: {
          error: "The email or password is not right. Check them and try again.",
          code: "auth.invalid-credentials",
          ref: "AB12CD34",
        },
      },
    });
    render(<App />);
    await fillLogin();

    expect(await screen.findByText(/email or password is not right/)).toBeInTheDocument();
    expect(screen.getByText("Reference: AB12CD34")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("disables the submit button while the request is pending", async () => {
    let release: () => void = () => {};

    mockApi({
      "api/auth/session": { body: signedOut },
      "POST api/auth/login": () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 401, body: { error: "No.", code: "auth.invalid-credentials" } });
        }),
    });
    render(<App />);
    await fillLogin();

    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });

  it("moves to the screen of each stage", async () => {
    for (const [stage, heading] of [
      ["password-change", "Choose a new password"],
      ["mfa-enrol", "Add a second sign-in step"],
      ["mfa-verify", "Second step"],
    ] as const) {
      mockApi({ "api/auth/session": { body: sessionView({ stage }) } });

      const { unmount } = render(<App />);

      expect(await screen.findByText(heading)).toBeInTheDocument();
      unmount();
    }
  });

  it("changes a forced password without asking for the current one", async () => {
    let stage = "password-change";
    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: sessionView({ stage: stage as "active" }) }),
      "POST api/auth/password": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "c2" } };
      },
    });

    render(<App />);
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("New password"), "a-long-new-password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/auth/password")?.body).toEqual({
      password: "a-long-new-password",
    });
  });

  it("refuses a password typed differently twice, before calling the server", async () => {
    const api = mockApi({ "api/auth/session": { body: sessionView({ stage: "password-change" }) } });

    render(<App />);
    await userEvent.type(await screen.findByLabelText("New password"), "one-password-here");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "another-password");
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));

    expect(await screen.findByText(/two passwords are not the same/)).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === "api/auth/password")).toBe(false);
  });

  it("reads the setup token from the hash, removes it from the address and uses it", async () => {
    window.location.hash = "#/setup/setup-token-123";
    const api = mockApi({
      "api/auth/session": { body: signedOut },
      "POST api/auth/setup": { body: { stage: "mfa-enrol", csrf: "c" } },
    });

    render(<App />);
    await userEvent.type(await screen.findByLabelText("New password"), "a-long-new-password");

    expect(window.location.hash).toBe("");

    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Create the admin account" }));

    await waitFor(() => expect(api.calls.some((call) => call.path === "api/auth/setup")).toBe(true));
    expect(api.calls.find((call) => call.path === "api/auth/setup")?.body).toEqual({
      token: "setup-token-123",
      password: "a-long-new-password",
    });
  });

  it("reads the invite token, shows the invited email and role, and accepts", async () => {
    window.location.hash = "#/invite/invite-token-9";
    const api = mockApi({
      "api/auth/session": { body: signedOut },
      "POST api/auth/invite/inspect": { body: { email: "new@example.com", role: "viewer" } },
      "POST api/auth/invite/accept": { body: { stage: "active", csrf: "c" } },
    });

    render(<App />);

    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
    expect(window.location.hash).toBe("");

    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-password");
    await userEvent.type(screen.getByLabelText("Repeat the new password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Create my account" }));

    await waitFor(() => expect(api.calls.some((call) => call.path === "api/auth/invite/accept")).toBe(true));
    expect(api.calls.find((call) => call.path === "api/auth/invite/inspect")?.body).toEqual({
      token: "invite-token-9",
    });
    expect(api.calls.find((call) => call.path === "api/auth/invite/accept")?.body).toEqual({
      token: "invite-token-9",
      password: "a-long-new-password",
    });
  });

  it("shows an invalid invite's error with its reference", async () => {
    window.location.hash = "#/invite/old";
    mockApi({
      "api/auth/session": { body: signedOut },
      "POST api/auth/invite/inspect": {
        status: 422,
        body: { error: "This invite is not valid any more. Ask an admin for a new link.", code: "invite.invalid", ref: "INV00001" },
      },
    });
    render(<App />);

    expect(await screen.findByText(/invite is not valid any more/)).toBeInTheDocument();
    expect(screen.getByText("Reference: INV00001")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("does nothing special in development", async () => {
    mockApi({ ...shellRoutes, "api/auth/session": { body: developmentSession } });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});

describe("second factor", () => {
  it("verifies with an authenticator code", async () => {
    let stage = "mfa-verify";
    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: sessionView({ stage: stage as "active" }) }),
      "POST api/auth/mfa": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "c" } };
      },
    });

    render(<App />);
    await userEvent.type(await screen.findByLabelText("Code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/auth/mfa")?.body).toEqual({ code: "123456" });
  });

  it("verifies with a recovery code", async () => {
    let stage = "mfa-verify";
    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: sessionView({ stage: stage as "active" }) }),
      "POST api/auth/mfa": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "c" } };
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Use a recovery code" }));
    await userEvent.type(screen.getByLabelText("Recovery code"), "abcd-efgh");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/auth/mfa")?.body).toEqual({ recoveryCode: "abcd-efgh" });
  });

  it("shows a wrong code's error and keeps the form", async () => {
    mockApi({
      "api/auth/session": { body: sessionView({ stage: "mfa-verify" }) },
      "POST api/auth/mfa": {
        status: 401,
        body: { error: "That code is not right. Wait for the next code and try again.", code: "auth.invalid-code", ref: "MFA12345" },
      },
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();
    expect(screen.getByText("Reference: MFA12345")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toHaveValue("000000");
  });

  it("offers passkeys only when the server does", async () => {
    mockApi({ "api/auth/session": { body: sessionView({ stage: "mfa-verify", methods: { totp: true, passkeys: false } }) } });

    const { unmount } = render(<App />);

    await screen.findByText("Second step");
    expect(screen.queryByRole("button", { name: "Use a passkey" })).not.toBeInTheDocument();
    unmount();

    mockApi({ "api/auth/session": { body: sessionView({ stage: "mfa-verify", methods: { totp: true, passkeys: true } }) } });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Use a passkey" })).toBeInTheDocument();
  });

  it("signs in with a passkey", async () => {
    let stage = "mfa-verify";

    startAuthentication.mockResolvedValue({ id: "assertion" });

    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: sessionView({ stage: stage as "active", methods: { totp: true, passkeys: true } }) }),
      "POST api/auth/passkey/options": { body: { challenge: "xyz" } },
      "POST api/auth/passkey/verify": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "c" } };
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "xyz" } });
    expect(api.calls.find((call) => call.path === "api/auth/passkey/options")?.body).toEqual({ purpose: "login" });
    expect(api.calls.find((call) => call.path === "api/auth/passkey/verify")?.body).toEqual({
      purpose: "login",
      response: { id: "assertion" },
    });
  });

  it("says what to do when the passkey prompt is cancelled", async () => {
    startAuthentication.mockRejectedValue(new Error("The operation was cancelled"));
    mockApi({
      "api/auth/session": { body: sessionView({ stage: "mfa-verify", methods: { totp: true, passkeys: true } }) },
      "POST api/auth/passkey/options": { body: { challenge: "xyz" } },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByText(/passkey prompt did not finish/)).toBeInTheDocument();
    expect(screen.getByText(/use another sign-in method/)).toBeInTheDocument();
  });
});

describe("enrolment", () => {
  const enrolment = {
    secret: "JBSWY3DPEHPK3PXP",
    uri: "otpauth://totp/Warlock:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Warlock",
    issuer: "Warlock",
    account: "admin@example.com",
  };

  it("renders the QR code and the secret, then confirms with a code", async () => {
    mockApi({
      "api/auth/session": { body: sessionView({ stage: "mfa-enrol" }) },
      "POST api/auth/totp/start": { body: enrolment },
      "POST api/auth/totp/confirm": { body: { stage: "active", csrf: "c", recoveryCodes: ["aaaa-1111", "bbbb-2222"] } },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Set up an authenticator app" }));

    const qr = await screen.findByRole("img", { name: /QR code/ });

    expect(qr.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("shows recovery codes once and goes on only after the confirm", async () => {
    let stage = "mfa-enrol";
    const api = mockApi({
      ...shellRoutes,
      "api/auth/session": () => ({ body: sessionView({ stage: stage as "active" }) }),
      "POST api/auth/totp/start": { body: enrolment },
      "POST api/auth/totp/confirm": () => {
        stage = "active";

        return { body: { stage: "active", csrf: "csrf-after", recoveryCodes: ["aaaa-1111", "bbbb-2222"] } };
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Set up an authenticator app" }));
    await userEvent.type(await screen.findByLabelText("Code from the app"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm the code" }));

    expect(await screen.findByText("aaaa-1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb-2222")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download .txt" })).toBeInTheDocument();

    const next = screen.getByRole("button", { name: "Continue" });

    expect(next).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Requests" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("I saved them"));
    expect(next).toBeEnabled();
    await userEvent.click(next);

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === "api/auth/totp/confirm")?.body).toEqual({ code: "123456" });
  });

  it("offers a passkey at enrolment only when the server does", async () => {
    mockApi({ "api/auth/session": { body: sessionView({ stage: "mfa-enrol", methods: { totp: true, passkeys: false } }) } });

    const { unmount } = render(<App />);

    await screen.findByText("Add a second sign-in step");
    expect(screen.queryByRole("button", { name: "Add a passkey instead" })).not.toBeInTheDocument();
    unmount();

    startRegistration.mockResolvedValue({ id: "attestation" });
    mockApi({
      "api/auth/session": { body: sessionView({ stage: "mfa-enrol", methods: { totp: true, passkeys: true } }) },
      "POST api/auth/passkey/options": { body: { challenge: "reg" } },
      "POST api/auth/passkey/verify": { body: { stage: "active", csrf: "c", recoveryCodes: ["cccc-3333"] } },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey instead" }));

    expect(await screen.findByText("cccc-3333")).toBeInTheDocument();
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "reg" } });
  });
});
