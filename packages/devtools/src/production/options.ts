import type { DevtoolsLogEntry, DevtoolsProductionOptions } from "../types";
import { DevtoolsProductionConfigError } from "./errors";
import { isValidNetworkEntry } from "./http/ip";

/**
 * `DevtoolsProductionOptions` with every default applied and the environment
 * read. Built once at boot by `resolveProductionOptions`.
 */
export type ResolvedDevtoolsProductionOptions = {
  /** The dashboard path, without a trailing slash. */
  path: string;
  /** The first admin from the environment; every field `null` when unset. */
  admin: { email: string | null; password: string | null; setupToken: string | null };
  sampleRate: number;
  slowRequestMs: number;
  slowQueryMs: number;
  maxRequests: number;
  /** Queries kept per sampled request; the rest are counted in `droppedQueries`. */
  maxQueriesPerRequest: number;
  /** Query shapes kept in memory per process (least recently seen evicted). */
  maxShapes: number;
  /** Route keys kept in memory per process. */
  maxRoutes: number;
  /** Error groups kept in memory per process. */
  maxErrorGroups: number;
  requestRetentionHours: number;
  maxStoredSamplesPerMinute: number;
  reportIntervalMs: number;
  trustedProxies: readonly string[];
  requireHttps: boolean;
  allowedIps: readonly string[];
  origin: string | null;
  session: { idleMinutes: number; maxHours: number; pendingMinutes: number };
  twoFactor: "admins" | "everyone";
  rateLimits: {
    windowMinutes: number;
    account: number;
    ip: number;
    global: number;
    lockMinutes: number;
  };
  explain: { executing: boolean };
  panels: Readonly<Record<string, boolean>>;
  logLevels: readonly DevtoolsLogEntry["level"][];
  auditRetentionDays: number;
  passkeys: { rpName: string; rpId: string | null };
};

/** The defaults `resolveProductionOptions` applies (environment values excluded). */
export const DEVTOOLS_PRODUCTION_DEFAULTS = {
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
  requireHttps: true,
  session: { idleMinutes: 30, maxHours: 8, pendingMinutes: 10 },
  twoFactor: "admins",
  rateLimits: { windowMinutes: 15, account: 5, ip: 20, global: 100, lockMinutes: 15 },
  explain: { executing: false },
  logLevels: ["warn", "error"],
  auditRetentionDays: 90,
  passkeys: { rpName: "Warlock monitor" },
} as const;

/** The environment variables production mode reads. */
export const DEVTOOLS_ENV = {
  path: "DEVTOOLS_PATH",
  adminEmail: "DEVTOOLS_ADMIN_EMAIL",
  adminPassword: "DEVTOOLS_ADMIN_PASSWORD",
  setupToken: "DEVTOOLS_SETUP_TOKEN",
} as const;

const LOG_LEVELS: readonly DevtoolsLogEntry["level"][] = [
  "debug",
  "info",
  "warn",
  "error",
  "success",
];

const PATH_CHARACTERS = /^[A-Za-z0-9._~/-]+$/;
const MIN_PATH_LENGTH = 8;
const MIN_SETUP_TOKEN_LENGTH = 32;

function invalid(option: string, expected: string): never {
  throw new DevtoolsProductionConfigError(
    "DT007",
    `Option "devtools.production.${option}" is not valid: ${expected}.`,
  );
}

function present(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function integerAtLeastOne(option: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  if (!Number.isInteger(value) || value < 1) invalid(option, "use a whole number of 1 or more");

  return value;
}

function networkList(option: string, value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    invalid(option, 'use a list of IPs, CIDR ranges, "loopback" or "private"');
  }

  for (const entry of value as readonly unknown[]) {
    if (!isValidNetworkEntry(entry)) {
      invalid(option, `"${String(entry)}" is not an IP, a CIDR range, "loopback" or "private"`);
    }
  }

  return [...value];
}

/** The dashboard path without a trailing slash, or a DT001/DT002 error. */
function resolvePath(value: string | undefined): string {
  const given = present(value);

  if (given === null) throw new DevtoolsProductionConfigError("DT001");

  const path = given.replace(/\/+$/, "");
  const segments = path.split("/").slice(1);
  const lower = path.toLowerCase();

  if (
    !path.startsWith("/") ||
    path.length < MIN_PATH_LENGTH ||
    !PATH_CHARACTERS.test(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    lower === "/__warlock" ||
    lower.startsWith("/__warlock/")
  ) {
    throw new DevtoolsProductionConfigError("DT002");
  }

  return path;
}

/**
 * Applies the defaults to `options`, reads the path and first admin from
 * `env`, and validates everything.
 *
 * Throws `DevtoolsProductionConfigError`: DT001 (no path), DT002 (bad path),
 * DT007 (an option out of range: sampleRate outside 0–1, a non-positive
 * limit, an unknown twoFactor value, a bad CIDR, an origin that is not
 * `https://host[:port]`), DT009 (both a password and a setup token), DT010
 * (setup token shorter than 32 characters). DT003/DT004 (admin) are checked
 * later by `ensureFirstAdmin`, which needs the database.
 */
export function resolveProductionOptions(
  options: DevtoolsProductionOptions | undefined,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedDevtoolsProductionOptions {
  const given = options ?? {};
  const defaults = DEVTOOLS_PRODUCTION_DEFAULTS;
  const path = resolvePath(given.path ?? env[DEVTOOLS_ENV.path]);

  const sampleRate = given.sampleRate ?? defaults.sampleRate;

  if (
    typeof sampleRate !== "number" ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 0 ||
    sampleRate > 1
  ) {
    invalid("sampleRate", "use a number from 0 to 1");
  }

  const requireHttps: boolean = given.requireHttps ?? defaults.requireHttps;

  if (typeof requireHttps !== "boolean") invalid("requireHttps", "use true or false");

  const twoFactor = given.twoFactor ?? defaults.twoFactor;

  if (twoFactor !== "admins" && twoFactor !== "everyone") {
    invalid("twoFactor", 'use "admins" or "everyone"');
  }

  const origin = given.origin ?? null;

  if (origin !== null) {
    const pattern = requireHttps ? /^https:\/\/[^/\s]+$/ : /^https?:\/\/[^/\s]+$/;

    if (typeof origin !== "string" || !pattern.test(origin)) {
      invalid(
        "origin",
        requireHttps
          ? "use an origin such as https://app.example.com, without a path or a trailing slash"
          : "use an origin such as http://localhost:3000, without a path or a trailing slash",
      );
    }
  }

  const panels: Readonly<Record<string, unknown>> = given.panels ?? {};

  if (panels === null || typeof panels !== "object" || Array.isArray(panels)) {
    invalid("panels", "use an object of tab ids and true or false");
  }

  for (const [id, enabled] of Object.entries(panels)) {
    if (typeof enabled !== "boolean") invalid(`panels.${id}`, "use true or false");
  }

  const logLevels = given.logLevels ?? defaults.logLevels;

  if (!Array.isArray(logLevels) || logLevels.some((level) => !LOG_LEVELS.includes(level))) {
    invalid("logLevels", `use a list of ${LOG_LEVELS.join(", ")}`);
  }

  const executing: boolean = given.explain?.executing ?? defaults.explain.executing;

  if (typeof executing !== "boolean") invalid("explain.executing", "use true or false");

  const rpName: string = given.passkeys?.rpName ?? defaults.passkeys.rpName;
  const rpId = given.passkeys?.rpId ?? null;

  if (typeof rpName !== "string" || rpName.trim() === "") {
    invalid("passkeys.rpName", "use a non-empty name");
  }

  if (rpId !== null && (typeof rpId !== "string" || rpId.trim() === "")) {
    invalid("passkeys.rpId", "use a host name such as app.example.com");
  }

  const limits = given.rateLimits ?? {};
  const session = given.session ?? {};

  const resolved: ResolvedDevtoolsProductionOptions = {
    path,
    admin: {
      email: present(env[DEVTOOLS_ENV.adminEmail]),
      password: present(env[DEVTOOLS_ENV.adminPassword]),
      setupToken: present(env[DEVTOOLS_ENV.setupToken]),
    },
    sampleRate,
    slowRequestMs: integerAtLeastOne("slowRequestMs", given.slowRequestMs, defaults.slowRequestMs),
    slowQueryMs: integerAtLeastOne("slowQueryMs", given.slowQueryMs, defaults.slowQueryMs),
    maxRequests: integerAtLeastOne("maxRequests", given.maxRequests, defaults.maxRequests),
    maxQueriesPerRequest: defaults.maxQueriesPerRequest,
    maxShapes: defaults.maxShapes,
    maxRoutes: defaults.maxRoutes,
    maxErrorGroups: defaults.maxErrorGroups,
    requestRetentionHours: integerAtLeastOne(
      "requestRetentionHours",
      given.requestRetentionHours,
      defaults.requestRetentionHours,
    ),
    maxStoredSamplesPerMinute: integerAtLeastOne(
      "maxStoredSamplesPerMinute",
      given.maxStoredSamplesPerMinute,
      defaults.maxStoredSamplesPerMinute,
    ),
    reportIntervalMs: integerAtLeastOne(
      "reportIntervalMs",
      given.reportIntervalMs,
      defaults.reportIntervalMs,
    ),
    trustedProxies: networkList("trustedProxies", given.trustedProxies),
    requireHttps,
    allowedIps: networkList("allowedIps", given.allowedIps),
    origin,
    session: {
      idleMinutes: integerAtLeastOne(
        "session.idleMinutes",
        session.idleMinutes,
        defaults.session.idleMinutes,
      ),
      maxHours: integerAtLeastOne("session.maxHours", session.maxHours, defaults.session.maxHours),
      pendingMinutes: defaults.session.pendingMinutes,
    },
    twoFactor,
    rateLimits: {
      windowMinutes: integerAtLeastOne(
        "rateLimits.windowMinutes",
        limits.windowMinutes,
        defaults.rateLimits.windowMinutes,
      ),
      account: integerAtLeastOne("rateLimits.account", limits.account, defaults.rateLimits.account),
      ip: integerAtLeastOne("rateLimits.ip", limits.ip, defaults.rateLimits.ip),
      global: integerAtLeastOne("rateLimits.global", limits.global, defaults.rateLimits.global),
      lockMinutes: integerAtLeastOne(
        "rateLimits.lockMinutes",
        limits.lockMinutes,
        defaults.rateLimits.lockMinutes,
      ),
    },
    explain: { executing },
    panels: { ...(panels as Readonly<Record<string, boolean>>) },
    logLevels: [...logLevels],
    auditRetentionDays: integerAtLeastOne(
      "auditRetentionDays",
      given.auditRetentionDays,
      defaults.auditRetentionDays,
    ),
    passkeys: { rpName, rpId },
  };

  if (resolved.admin.password !== null && resolved.admin.setupToken !== null) {
    throw new DevtoolsProductionConfigError("DT009");
  }

  if (
    resolved.admin.setupToken !== null &&
    resolved.admin.setupToken.length < MIN_SETUP_TOKEN_LENGTH
  ) {
    throw new DevtoolsProductionConfigError("DT010");
  }

  return resolved;
}
