import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, {
  type FastifyInstance,
  type InjectOptions,
  type LightMyRequestResponse,
} from "fastify";
import { vi } from "vitest";
import { totpCode } from "../../../../core/src/encryption/totp";
import { checkDevtoolsPanels, type MountedDevtoolsPanel } from "../../../src/panels";
import { createDevtoolsAuth } from "../../../src/production/auth";
import type { DevtoolsAuthService, DevtoolsCrypto } from "../../../src/production/auth";
import type { DevtoolsInstanceInfo } from "../../../src/production/contracts";
import { createDashboardState, mountProductionDevtools } from "../../../src/production/http";
import { resolveProductionOptions } from "../../../src/production/options";
import type { ResolvedDevtoolsProductionOptions } from "../../../src/production/options";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import type { DevtoolsStore } from "../../../src/production/store/types";
import type { DevtoolsOptions, DevtoolsPanel, DevtoolsProductionOptions } from "../../../src/types";

export const PATH = "/ops-7f3k2q9x";
export const HOST = "app.example.com";
export const ORIGIN = `https://${HOST}`;
export const PASSWORD = "correct horse battery";
export const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "test-panel",
);

export const instance: DevtoolsInstanceInfo = {
  id: "host:1:abc",
  label: "host pid 1",
  host: "host",
  pid: 1,
  worker: null,
  startedAt: 0,
  seenAt: 0,
  nodeVersion: "v22.0.0",
};

/** Fast, deterministic crypto; TOTP codes come from core's helper. */
export function fakeCrypto(): DevtoolsCrypto {
  return {
    hashPassword: async (password) => `hash:${password}`,
    verifyPassword: async (password, hash) => hash === `hash:${password}`,
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (cipher) => cipher.slice(4),
    generateTotpSecret: () => TOTP_SECRET,
    verifyTotp(secret, code, at) {
      for (let step = Math.floor(at / 30_000) - 1; step <= Math.floor(at / 30_000) + 1; step++) {
        if (totpCode(secret, step * 30_000) === code) return step;
      }

      return null;
    },
    totpUri: ({ secret, account, issuer }) =>
      `otpauth://totp/${issuer}:${account}?secret=${secret}`,
    hmac: (value) => createHash("sha256").update(`app-key:${value}`).digest("hex"),
  };
}

/** A panel with a GET route, a POST route and a DELETE route. */
export function testPanel(overrides: Partial<DevtoolsPanel> = {}): DevtoolsPanel {
  return {
    id: "test-panel",
    title: "Test panel",
    view: path.join(fixtures, "view.js"),
    production: true,
    routes: [
      { path: "/search", handler: ({ query }) => ({ results: [query.q] }) },
      { method: "POST", path: "/items", handler: ({ body }) => ({ received: body }) },
      { method: "DELETE", path: "/items", handler: () => undefined },
    ],
    ...overrides,
  };
}

export function mounted(panels: readonly DevtoolsPanel[]): MountedDevtoolsPanel[] {
  return checkDevtoolsPanels(panels);
}

/** A collector with `subscribe` and `emit`, and empty lists for everything else. */
export function fakeCollector() {
  const listeners = new Set<(event: unknown) => void>();

  return {
    listRequests: () => [],
    getRequest: () => undefined,
    listMails: () => [{ id: "m1", capturedAt: 1, to: ["a@b.c"], subject: "Hi" }],
    getMail: () => undefined,
    listLogs: () => [],
    getBackground: () => ({ queries: [], cache: [], logs: [] }),
    subscribe(listener: (event: unknown) => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    emit(event: unknown) {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
    clear: () => undefined,
  };
}

export type TestApp = Awaited<ReturnType<typeof createApp>>;

export type AppConfig = {
  production?: DevtoolsProductionOptions;
  panels?: readonly DevtoolsPanel[];
  builtInPanels?: readonly string[];
  store?: DevtoolsStore;
  /** Register an app-wide CORS hook before the dashboard. */
  cors?: boolean;
  /** The app's own not-found handler; the default is Fastify's. */
  notFound?: "default" | "custom";
  /** Extra options for the development deps the shared route files read. */
  routes?: Record<string, unknown>;
  /** Extra environment for `resolveProductionOptions` (the first admin). */
  env?: Record<string, string>;
  /** How long the open/closed state is cached (ms). */
  stateTtlMs?: number;
};

export async function createApp(config: AppConfig = {}) {
  const store = config.store ?? createMemoryStore();
  const options: ResolvedDevtoolsProductionOptions = resolveProductionOptions(
    { origin: ORIGIN, trustedProxies: ["loopback"], ...config.production },
    { DEVTOOLS_PATH: PATH, ...config.env },
  );
  const warnings: string[] = [];
  const auth: DevtoolsAuthService = createDevtoolsAuth({
    store,
    options,
    instance,
    crypto: fakeCrypto(),
    passkeys: null,
    warn: (message) => warnings.push(message),
  });
  const state = createDashboardState(store, options.path, {
    ...(config.stateTtlMs === undefined ? {} : { ttlMs: config.stateTtlMs }),
  });
  const collector = fakeCollector();
  const explain = vi.fn(async (shapeId: string) => ({
    shapeId,
    driver: "postgres" as const,
    executing: false,
    plan: [],
    instance: instance.id,
  }));
  const app: FastifyInstance = Fastify();

  if (config.cors) {
    app.addHook("onRequest", async (_request, reply) => {
      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-allow-credentials", "true");
    });
  }

  if (config.notFound === "custom") {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send("app not found"));
  }

  app.get("/app-route", async () => ({ app: true }));

  const resolved = {
    path: "/__unused",
    maxRequests: 200,
    nPlusOneThreshold: 5,
    allowedHosts: [],
    allowProxied: false,
    panels: [],
  } as unknown as DevtoolsOptions;

  mountProductionDevtools(app, {
    routes: {
      collector: collector as never,
      options: resolved as never,
      isDevelopment: () => false,
      listRoutes: () => [{ method: "GET", path: "/app-route" }],
      ...(config.routes ?? {}),
    },
    production: options,
    store,
    auth,
    capture: {
      collector,
      requests: { list: async () => [], get: async () => null, clear: async () => 0 },
      explain,
    } as never,
    insights: {} as never,
    instance,
    panels: mounted(config.panels ?? []),
    builtInPanels: config.builtInPanels ?? [
      "requests",
      "queries",
      "routes",
      "resources",
      "health",
      "errors",
      "logs",
      "jobs",
    ],
    state,
    warn: (message) => warnings.push(message),
  });

  await app.ready();

  const defaults = (extra: InjectOptions): InjectOptions => ({
    remoteAddress: "127.0.0.1",
    ...extra,
    headers: {
      host: HOST,
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.5",
      ...(extra.headers as Record<string, string> | undefined),
    },
  });

  const inject = (extra: InjectOptions): Promise<LightMyRequestResponse> =>
    app.inject(defaults(extra));

  /** A request carrying the browser headers of a same-origin fetch from the dashboard. */
  const send = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    route: string,
    init: { session?: Session | null; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    inject({
      method,
      url: `${options.path}${route}`,
      ...(init.body === undefined ? {} : { payload: init.body as object }),
      headers: {
        ...(method === "GET" ? {} : { origin: ORIGIN }),
        ...(init.session
          ? {
              cookie: `${cookieName(options)}=${init.session.token}`,
              ...(method === "GET" ? {} : { "x-devtools-csrf": init.session.csrf }),
            }
          : {}),
        ...init.headers,
      },
    });

  type Session = { token: string; csrf: string; accountId: string };

  /** Creates an account (an admin has an authenticator app enrolled). */
  function addAccount(
    email: string,
    role: "admin" | "viewer" = "viewer",
    patch: Partial<Parameters<DevtoolsStore["accounts"]["create"]>[0]> = {},
  ) {
    return store.accounts.create({
      email,
      role,
      passwordHash: `hash:${PASSWORD}`,
      passwordSource: "user",
      mustChangePassword: false,
      totpSecret: role === "admin" ? `enc:${TOTP_SECRET}` : null,
      totpEnabledAt: role === "admin" ? Date.now() : null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: null,
      lastLoginAt: null,
      createdBy: null,
      ...patch,
    });
  }

  /** Creates an account and signs it in through the HTTP routes. */
  async function signIn(
    email: string,
    role: "admin" | "viewer" = "viewer",
    extra: { password?: string } = {},
  ): Promise<Session> {
    const account = await addAccount(email, role, {
      passwordHash: `hash:${extra.password ?? PASSWORD}`,
    });
    const login = await send("POST", "/api/auth/login", {
      body: { email, password: extra.password ?? PASSWORD },
    });

    if (login.statusCode !== 200)
      throw new Error(`login answered ${login.statusCode}: ${login.body}`);

    let token = tokenOf(login);
    let step = login.json<{ stage: string; csrf: string }>();

    if (step.stage === "mfa-verify") {
      const mfa = await send("POST", "/api/auth/mfa", {
        session: { token, csrf: step.csrf, accountId: account.id },
        body: { code: totpCode(TOTP_SECRET, Date.now()) },
      });

      if (mfa.statusCode !== 200) throw new Error(`mfa answered ${mfa.statusCode}: ${mfa.body}`);

      token = tokenOf(mfa) ?? token;
      step = mfa.json();
    }

    if (step.stage !== "active" || token === undefined)
      throw new Error("the account did not reach active");

    return { token, csrf: step.csrf, accountId: account.id };
  }

  return {
    app,
    store,
    auth,
    options,
    state,
    collector,
    explain,
    warnings,
    inject,
    send,
    signIn,
    addAccount,
  };
}

export function cookieName(options: ResolvedDevtoolsProductionOptions): string {
  return options.requireHttps ? "__Secure-warlock-devtools" : "warlock-devtools";
}

/** The session token a response sets, or `undefined`. */
export function tokenOf(response: LightMyRequestResponse): string | undefined {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header === undefined ? [] : [header];

  for (const cookie of cookies) {
    const match = /^(?:__Secure-)?warlock-devtools=([^;]*)/.exec(cookie);

    if (match) return match[1] === "" ? undefined : match[1];
  }

  return undefined;
}
