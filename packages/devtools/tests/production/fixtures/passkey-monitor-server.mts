// A standalone app for the browser passkey spec: the real production monitor
// (real passkey ceremonies over @simplewebauthn/server, real TOTP, scrypt
// passwords, the built dashboard) on an in-memory store. Started by the e2e
// harness through tsx; the port and the admin's secrets come from its env.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { generateTotpSecret, totpCode } from "../../../../core/src/encryption/totp";
import { checkDevtoolsPanels } from "../../../src/panels";
import { createDevtoolsAuth, loadDevtoolsPasskeys } from "../../../src/production/auth";
import type { DevtoolsCrypto } from "../../../src/production/auth";
import { createDashboardState, mountProductionDevtools } from "../../../src/production/http";
import { resolveProductionOptions } from "../../../src/production/options";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import type { DevtoolsOptions } from "../../../src/types";

const port = Number(process.env.PORT);
const path = process.env.DEVTOOLS_PATH ?? "/ops-e2e-passkey";
const origin = `http://localhost:${port}`;
const email = "admin@example.com";
const password = process.env.PASSKEY_E2E_PASSWORD ?? "correct horse battery";
const totpSecret = process.env.PASSKEY_E2E_TOTP_SECRET ?? generateTotpSecret();

const derive = (value: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(value, salt, 32, (error, key) => (error ? reject(error) : resolve(key))),
  );

const crypto: DevtoolsCrypto = {
  async hashPassword(value) {
    const salt = randomBytes(16);

    return `scrypt:${salt.toString("hex")}:${(await derive(value, salt)).toString("hex")}`;
  },
  async verifyPassword(value, hash) {
    const [, salt, key] = hash.split(":");

    return timingSafeEqual(await derive(value, Buffer.from(salt ?? "", "hex")), Buffer.from(key ?? "", "hex"));
  },
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (cipher) => cipher.slice(4),
  generateTotpSecret,
  verifyTotp(secret, code, at) {
    for (let step = Math.floor(at / 30_000) - 1; step <= Math.floor(at / 30_000) + 1; step++) {
      if (totpCode(secret, step * 30_000) === code) return step;
    }

    return null;
  },
  totpUri: ({ secret, account, issuer }) => `otpauth://totp/${issuer}:${account}?secret=${secret}`,
  hmac: (value) => createHash("sha256").update(`passkey-e2e:${value}`).digest("hex"),
};

const store = createMemoryStore();
const options = resolveProductionOptions(
  { origin, requireHttps: false },
  { DEVTOOLS_PATH: path },
);
const instance = {
  id: "e2e:1:abc",
  label: "e2e",
  host: "e2e",
  pid: process.pid,
  worker: null,
  startedAt: Date.now(),
  seenAt: Date.now(),
  nodeVersion: process.version,
};
const passkeys = await loadDevtoolsPasskeys();

if (passkeys === null) throw new Error("@simplewebauthn/server cannot be loaded");

const auth = createDevtoolsAuth({ store, options, instance, crypto, passkeys, warn: console.warn });

await store.accounts.create({
  email,
  role: "admin",
  passwordHash: await crypto.hashPassword(password),
  passwordSource: "user",
  mustChangePassword: false,
  totpSecret: `enc:${totpSecret}`,
  totpEnabledAt: Date.now(),
  totpLastStep: null,
  recoveryCodes: [],
  passkeys: [],
  failuresResetAt: null,
  lastLoginAt: null,
  createdBy: null,
});

const collector = {
  listRequests: () => [],
  getRequest: () => undefined,
  listMails: () => [],
  getMail: () => undefined,
  listLogs: () => [],
  getBackground: () => ({ queries: [], cache: [], logs: [] }),
  subscribe: () => () => undefined,
  clear: () => undefined,
};
const app = Fastify();

app.get("/", async () => ({ ready: true }));

mountProductionDevtools(app, {
  routes: {
    collector: collector as never,
    options: {
      path: "/__unused",
      maxRequests: 200,
      nPlusOneThreshold: 5,
      allowedHosts: [],
      allowProxied: false,
      panels: [],
    } as unknown as DevtoolsOptions as never,
    isDevelopment: () => false,
    listRoutes: () => [],
  },
  production: options,
  store,
  auth,
  capture: {
    collector,
    requests: { list: async () => [], get: async () => null, clear: async () => 0 },
    explain: async () => ({}),
  } as never,
  insights: {} as never,
  instance,
  panels: checkDevtoolsPanels([]),
  builtInPanels: ["health"],
  state: createDashboardState(store, options.path),
  warn: console.warn,
  hmac: crypto.hmac,
});

await app.listen({ host: "127.0.0.1", port });
