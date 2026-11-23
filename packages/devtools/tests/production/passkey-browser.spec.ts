import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { totpCode } from "../../../core/src/encryption/totp";
import { defineE2E, findBrowserBinary, runE2E } from "../../../core/src/e2e";
import { addVirtualAuthenticator } from "../../../core/src/e2e/webauthn";

const binary = await findBrowserBinary();
const test = it.skipIf(!binary);
const missing = binary ? "" : " [skipped: no Chrome/Edge binary found; set WARLOCK_E2E_BROWSER]";
const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "fixtures", "passkey-monitor-server.mts");
const MONITOR = "/ops-e2e-passkey";
const PASSWORD = "correct horse battery";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const outputs: string[] = [];

afterAll(async () => {
  for (const directory of outputs) await rm(directory, { recursive: true, force: true });
});

/** The tsx that runs the standalone monitor: the first one found walking up from this folder. */
function findTsx(): string {
  let current = here;

  while (true) {
    const candidate = path.join(current, "node_modules", "tsx", "dist", "cli.mjs");

    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(current);

    if (parent === current) throw new Error("tsx is not installed in this workspace");

    current = parent;
  }
}

/** A JSON call from the page, with the CSRF token of the step in force. Resolves `{ status, body }`. */
const apiCall = (route: string, method: string, csrf: string | null, body?: unknown) => `
  (async () => {
    const response = await fetch(${JSON.stringify(`${MONITOR}/${route}`)}, {
      method: ${JSON.stringify(method)},
      headers: { ${body === undefined ? "" : `"content-type": "application/json",`} ${csrf === null ? "" : `"x-devtools-csrf": ${JSON.stringify(csrf)}`} },
      ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`}
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? null : JSON.parse(text) };
  })()
`;

/** The browser's own passkey ceremony ("create" registers, "get" signs), answered by the virtual authenticator. */
const ceremony = (kind: "create" | "get", optionsJson: unknown) => `
  (async () => {
    const optionsJSON = ${JSON.stringify(optionsJson)};
    const credential = ${
      kind === "create"
        ? "await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(optionsJSON) })"
        : "await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(optionsJSON) })"
    };
    return credential.toJSON();
  })()
`;

test(
  "registers a passkey, signs in with it and uses it as the step-up for recovery codes" + missing,
  async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "warlock-passkey-e2e-"));

    outputs.push(outputDirectory);

    const result = await runE2E(
      defineE2E({
        app: {
          directory: path.join(here, "fixtures"),
          start: [process.execPath, findTsx(), server],
          env: {
            DEVTOOLS_PATH: MONITOR,
            PASSKEY_E2E_PASSWORD: PASSWORD,
            PASSKEY_E2E_TOTP_SECRET: TOTP_SECRET,
          },
          startupTimeoutMs: 90_000,
        },
        browser: {
          binary,
          args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
          startupTimeoutMs: 60_000,
        },
        timeoutMs: 240_000,
        // The page is the monitor's own; the browser also asks for a favicon the fixture does not serve.
        allowNetworkFailures: [{ url: /\/favicon\.ico$/, status: 404 }],
        allowConsoleErrors: [/status of 404 \(Not Found\)/],
        run: async ({ page, port, step }) => {
          // WebAuthn needs a host name, not an address: `localhost` reaches the same server.
          const home = `http://localhost:${port}${MONITOR}/`;
          const authenticator = await addVirtualAuthenticator(page);
          const call = async <T>(
            route: string,
            method: string,
            csrf: string | null,
            body?: unknown,
          ) => page.evaluate<{ status: number; body: T }>(apiCall(route, method, csrf, body));
          const signIn = async () => {
            const login = await call<{ stage: string; csrf: string }>(
              "api/auth/login",
              "POST",
              null,
              {
                email: "admin@example.com",
                password: PASSWORD,
              },
            );

            expect(login.status).toBe(200);
            expect(login.body.stage).toBe("mfa-verify");

            return login.body.csrf;
          };
          let csrf = "";

          await step("open the dashboard on localhost", async () => {
            await page.goto(home);
          });

          await step("sign in with the password and the authenticator code", async () => {
            const first = await signIn();
            const mfa = await call<{ stage: string; csrf: string }>("api/auth/mfa", "POST", first, {
              code: totpCode(TOTP_SECRET, Date.now()),
            });

            expect(mfa.status).toBe(200);
            expect(mfa.body.stage).toBe("active");
            csrf = mfa.body.csrf;
          });

          await step("register a passkey with the virtual authenticator", async () => {
            const registration = await call<Record<string, unknown>>(
              "api/account/passkey/options",
              "POST",
              csrf,
              { purpose: "register" },
            );

            expect(registration.status).toBe(200);

            const created = await page.evaluate(ceremony("create", registration.body));
            const verified = await call("api/account/passkey/verify", "POST", csrf, {
              purpose: "register",
              response: created,
              current: PASSWORD,
            });

            expect(verified.status).toBe(200);
            expect(await authenticator.credentials()).toHaveLength(1);
          });

          await step("sign out", async () => {
            expect((await call("api/auth/logout", "POST", csrf)).status).toBe(204);
          });

          await step("sign in again with the passkey", async () => {
            const pending = await signIn();
            const options = await call<Record<string, unknown>>(
              "api/auth/passkey/options",
              "POST",
              pending,
              { purpose: "login" },
            );

            expect(options.status).toBe(200);

            const asserted = await page.evaluate(ceremony("get", options.body));
            const verified = await call<{ stage: string; csrf: string }>(
              "api/auth/passkey/verify",
              "POST",
              pending,
              { purpose: "login", response: asserted },
            );

            expect(verified.status).toBe(200);
            expect(verified.body.stage).toBe("active");
            csrf = verified.body.csrf;
          });

          await step("make recovery codes with the passkey as the step-up", async () => {
            const options = await call<Record<string, unknown>>(
              "api/account/passkey/options",
              "POST",
              csrf,
              { purpose: "login" },
            );
            const asserted = await page.evaluate(ceremony("get", options.body));
            const verified = await call("api/account/passkey/verify", "POST", csrf, {
              purpose: "login",
              response: asserted,
            });

            expect(verified.status).toBe(200);

            const codes = await call<{ codes: string[] }>(
              "api/account/recovery-codes",
              "POST",
              csrf,
              {},
            );

            expect(codes.status).toBe(200);
            expect(codes.body.codes.length).toBeGreaterThan(0);

            // Two assertions (sign-in, step-up) on top of the registration.
            const [credential] = await authenticator.credentials();

            expect(credential?.signCount).toBeGreaterThanOrEqual(2);
          });
        },
      }),
      { outputDirectory },
    );

    expect(result.evidence.errors).toEqual([]);
    expect(result.evidence.status).toBe("passed");
    expect(result.evidence.processes.every(({ stopped }) => stopped)).toBe(true);
  },
  300_000,
);
