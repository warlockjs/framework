import { createHash } from "node:crypto";
import { totpCode } from "../../../../core/src/encryption/totp";
import type { DevtoolsInstanceInfo } from "../../../src/production/contracts";
import { createDevtoolsAuth } from "../../../src/production/auth";
import type {
  DevtoolsAuthenticated,
  DevtoolsAuthStep,
  DevtoolsCrypto,
  DevtoolsPasskeys,
  DevtoolsRequestMeta,
} from "../../../src/production/auth";
import type { ResolvedDevtoolsProductionOptions } from "../../../src/production/options";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import type { DevtoolsAccountRecord } from "../../../src/production/store/types";

export const START = Date.UTC(2026, 10, 17, 12, 0, 0);
export const MINUTE = 60_000;

export const instance: DevtoolsInstanceInfo = {
  id: "host:1:abc",
  label: "host pid 1",
  host: "host",
  pid: 1,
  worker: null,
  startedAt: START,
  seenAt: START,
  nodeVersion: "v22.0.0",
};

export function meta(ip = "203.0.113.5"): DevtoolsRequestMeta {
  return {
    ip,
    userAgent: "vitest",
    origin: "https://app.example.com",
    hostname: "app.example.com",
  };
}

export function baseOptions(
  overrides: Partial<ResolvedDevtoolsProductionOptions> = {},
): ResolvedDevtoolsProductionOptions {
  return {
    path: "/ops-7f3k2q9x",
    admin: { email: null, password: null, setupToken: null },
    sampleRate: 0.1,
    slowRequestMs: 1000,
    slowQueryMs: 200,
    maxRequests: 200,
    maxQueriesPerRequest: 200,
    maxShapes: 500,
    maxRoutes: 300,
    maxErrorGroups: 100,
    requestRetentionHours: 24,
    maxStoredSamplesPerMinute: 120,
    reportIntervalMs: 10_000,
    trustedProxies: [],
    requireHttps: true,
    allowedIps: [],
    origin: null,
    session: { idleMinutes: 30, maxHours: 8, pendingMinutes: 10 },
    twoFactor: "admins",
    rateLimits: { windowMinutes: 15, account: 5, ip: 20, global: 100, lockMinutes: 15 },
    explain: { executing: false },
    panels: {},
    logLevels: ["warn", "error"],
    auditRetentionDays: 90,
    passkeys: { rpName: "Warlock monitor", rpId: null },
    ...overrides,
  };
}

/** The TOTP secret the fake crypto uses for `generateTotpSecret` (real base32). */
export const FAKE_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export type FakeCrypto = DevtoolsCrypto & {
  hashCalls: string[];
  verifyCalls: { password: string; hash: string }[];
  /** Makes `verifyPassword` wait until the returned function is called. */
  holdVerifications(): () => void;
};

export function createFakeCrypto(now: () => number): FakeCrypto {
  let gate: Promise<void> | null = null;
  const fake: FakeCrypto = {
    hashCalls: [],
    verifyCalls: [],
    holdVerifications() {
      let release: () => void = () => undefined;

      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });

      return release;
    },
    async hashPassword(password) {
      fake.hashCalls.push(password);

      return `hash:${password}`;
    },
    async verifyPassword(password, hash) {
      fake.verifyCalls.push({ password, hash });

      if (gate) await gate;

      return hash === `hash:${password}`;
    },
    encrypt: (plain) => `enc:${plain}`,
    decrypt(cipher) {
      if (!cipher.startsWith("enc:")) throw new Error("bad cipher");

      return cipher.slice(4);
    },
    generateTotpSecret: () => FAKE_SECRET,
    verifyTotp(secret, code, at) {
      // The real helper, so codes come from `totpCode` in specs.
      const given = code.replace(/\s/g, "");

      if (!/^\d{6}$/.test(given)) return null;

      for (let step = Math.floor(at / 30_000) - 1; step <= Math.floor(at / 30_000) + 1; step++) {
        if (totpCode(secret, step * 30_000) === given) return step;
      }

      return null;
    },
    totpUri: ({ secret, account, issuer }) => `otpauth://totp/${issuer}:${account}?secret=${secret}`,
    hmac: (value) => createHash("sha256").update(`app-key:${value}`).digest("hex"),
  };

  void now;

  return fake;
}

export function createFakePasskeys(): DevtoolsPasskeys & {
  failNext: boolean;
  calls: string[];
} {
  const fake = {
    failNext: false,
    calls: [] as string[],
    async registrationOptions() {
      fake.calls.push("registrationOptions");

      return { options: { kind: "register" }, challenge: "reg-challenge" };
    },
    async verifyRegistration(input: { response: unknown; challenge: string }) {
      fake.calls.push(`verifyRegistration:${input.challenge}`);

      if (fake.failNext) throw new Error("bad attestation");

      return {
        id: (input.response as { id: string }).id,
        publicKey: "pk",
        counter: 0,
        transports: ["internal"],
      };
    },
    async authenticationOptions() {
      fake.calls.push("authenticationOptions");

      return { options: { kind: "login" }, challenge: "auth-challenge" };
    },
    async verifyAuthentication(input: { response: unknown; challenge: string }) {
      fake.calls.push(`verifyAuthentication:${input.challenge}`);

      if (fake.failNext) throw new Error("bad assertion");

      return { id: (input.response as { id: string }).id, newCounter: 7 };
    },
  };

  return fake;
}

export function createWorld(
  config: {
    options?: Partial<ResolvedDevtoolsProductionOptions>;
    passkeys?: boolean;
  } = {},
) {
  let time = START;
  const clock = () => time;
  const store = createMemoryStore({ now: clock });
  const crypto = createFakeCrypto(clock);
  const passkeys = config.passkeys ? createFakePasskeys() : null;
  const options = baseOptions(config.options);
  const warnings: string[] = [];
  const auth = createDevtoolsAuth({
    store,
    options,
    instance,
    crypto,
    passkeys,
    now: clock,
    warn: (message) => warnings.push(message),
  });

  return {
    auth,
    store,
    crypto,
    passkeys,
    options,
    warnings,
    now: clock,
    advance(ms: number) {
      time += ms;
    },
    /** Creates an account directly with a known password (`hash:<password>`). */
    async addAccount(
      email: string,
      patch: Partial<Omit<DevtoolsAccountRecord, "id" | "createdAt" | "updatedAt" | "version">> & {
        password?: string;
      } = {},
    ): Promise<DevtoolsAccountRecord> {
      const { password = "correct horse battery", ...rest } = patch;

      return store.accounts.create({
        email,
        role: "viewer",
        passwordHash: `hash:${password}`,
        passwordSource: "user",
        mustChangePassword: false,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        recoveryCodes: [],
        passkeys: [],
        failuresResetAt: null,
        lastLoginAt: null,
        createdBy: null,
        ...rest,
      });
    },
    /** A TOTP code valid now for `FAKE_SECRET`. */
    code(offsetSteps = 0): string {
      return totpCode(FAKE_SECRET, time + offsetSteps * 30_000);
    },
  };
}

export type World = ReturnType<typeof createWorld>;

/** Authenticates the cookie token of a step. */
export async function authOf(world: World, step: DevtoolsAuthStep): Promise<DevtoolsAuthenticated> {
  if (step.token === null) throw new Error("the step carries no token");

  const result = await world.auth.authenticate(step.token);

  if (!result) throw new Error("the token did not authenticate");

  return result;
}

/** The auth of a step whose session may not have a new token: re-reads by the session record. */
export async function reload(world: World, auth: DevtoolsAuthenticated): Promise<DevtoolsAuthenticated> {
  const session = (await world.store.sessions.listForAccount(auth.account.id)).find(
    (candidate) => candidate.id === auth.session.id,
  );
  const account = await world.store.accounts.findById(auth.account.id);

  if (!session || !account) throw new Error("session or account is gone");

  return { session, account, stage: session.stage };
}

/** Signs a viewer in with the default password and returns the active auth. */
export async function signedIn(world: World, email: string, role: "admin" | "viewer" = "viewer") {
  await world.addAccount(email, { role, ...(role === "admin" ? { totpSecret: "enc:" + FAKE_SECRET } : {}) });

  let step = await world.auth.login({ email, password: "correct horse battery" }, meta());

  if (step.stage === "mfa-verify") {
    step = await world.auth.verifySecondFactor(await authOf(world, step), { code: world.code() }, meta());
  }

  return authOf(world, step);
}
