import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { isInstalledInProject, isSet, warnOnError } from "./config-values";

/** Signing secrets shorter than this can be guessed offline from one captured token. */
const MIN_SECRET_BYTES = 32;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365.25 * DAY;

/** Access-token lifetimes past this are reported. */
const LONG_ACCESS_TOKEN_MS = 30 * DAY;

/** A lifetime this long is a token that never expires in practice (`NO_EXPIRATION` is `"100y"`). */
const NEVER_EXPIRES_MS = 10 * YEAR;

/** With refresh tokens off, access tokens living longer than this are reported. */
const NO_REFRESH_ACCESS_TOKEN_MS = DAY;

/** Lifetime used by auth when `accessToken.expiresIn` is not set. */
const DEFAULT_ACCESS_TOKEN_EXPIRES_IN = "1h";

/** Milliseconds per duration unit, in the forms auth's duration strings accept. */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  msec: 1,
  msecs: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
  w: 7 * DAY,
  week: 7 * DAY,
  weeks: 7 * DAY,
  y: YEAR,
  yr: YEAR,
  yrs: YEAR,
  year: YEAR,
  years: YEAR,
};

/**
 * A duration string (`"1h"`, `"7d"`, `"100y"`, `"15 minutes"`) in
 * milliseconds, or `undefined` when it is not one. Auth refuses anything else
 * (numbers included) with its own error at the first token it signs, so an
 * unreadable value is left to that error.
 */
export function parseDurationMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const match = /^(\d*\.?\d+)\s*([a-z]*)$/i.exec(value.trim());

  if (!match) return undefined;

  const [, amount = "", unit = ""] = match;
  const perUnit = unit === "" ? 1 : UNIT_MS[unit.toLowerCase()];

  return perUnit === undefined ? undefined : Number(amount) * perUnit;
}

/**
 * A setting read the way auth reads it: the current `auth.<key>`, else the
 * deprecated `auth.<legacyKey>`, else `undefined`.
 */
function authSetting(key: string, legacyKey: string): unknown {
  const current: unknown = config.get(`auth.${key}`);

  if (isSet(current)) return current;

  const legacy: unknown = config.get(`auth.${legacyKey}`);

  return isSet(legacy) ? legacy : undefined;
}

/** A non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** One finding about a signing secret, or `undefined` when it is long enough or unset. */
function secretFinding(key: string, legacyKey: string): string | undefined {
  const secret = text(authSetting(key, legacyKey));

  // A missing access secret is the `jwt-secret` check's failure, not a finding here.
  if (!secret) return undefined;

  const length = Buffer.byteLength(secret);

  if (length >= MIN_SECRET_BYTES) return undefined;

  return (
    `auth.${key} is ${length} bytes — a captured token lets an attacker guess a short ` +
    `secret offline and forge tokens. Set a secret of at least ${MIN_SECRET_BYTES} bytes ` +
    "(`warlock jwt.generate` creates one)."
  );
}

/** The access-token lifetime finding, or `undefined` when the lifetime is fine or unreadable. */
function lifetimeFinding(): string | undefined {
  const raw =
    authSetting("accessToken.expiresIn", "jwt.expiresIn") ?? DEFAULT_ACCESS_TOKEN_EXPIRES_IN;
  const lifetime = parseDurationMs(raw);

  if (lifetime === undefined) return undefined;

  const refreshEnabled = authSetting("refreshToken.enabled", "jwt.refresh.enabled") !== false;
  const shown = JSON.stringify(raw);

  const refreshFix = refreshEnabled
    ? ""
    : " and turn refresh tokens on (auth.refreshToken.enabled: true) so sessions outlive it";

  const refreshNote = refreshEnabled ? "" : ", and refresh tokens are off";

  if (lifetime >= NEVER_EXPIRES_MS) {
    return (
      `auth.accessToken.expiresIn is ${shown}, so access tokens never expire${refreshNote} — ` +
      "a stolen token works for good. Set a short auth.accessToken.expiresIn (for example " +
      `"1h")${refreshFix}.`
    );
  }

  if (lifetime > LONG_ACCESS_TOKEN_MS) {
    return (
      `auth.accessToken.expiresIn is ${shown}, longer than 30 days${refreshNote} — a stolen ` +
      "token stays usable that long. Set a short auth.accessToken.expiresIn (for example " +
      `"1h")${refreshFix}.`
    );
  }

  if (!refreshEnabled && lifetime > NO_REFRESH_ACCESS_TOKEN_MS) {
    return (
      `auth.accessToken.expiresIn is ${shown} and refresh tokens are off ` +
      "(auth.refreshToken.enabled: false) — a stolen token stays usable for that whole time, " +
      'and nothing renews a shorter one. Set a short auth.accessToken.expiresIn (for example "1h")' +
      `${refreshFix}.`
    );
  }

  return undefined;
}

/**
 * Warns about token settings that make a leaked or guessed token last: signing
 * secrets shorter than 32 bytes, access tokens that never expire or live longer
 * than 30 days, and long-lived access tokens with refresh tokens off.
 *
 * NEEDS NO BOOTED APP — it reads config only, the way `@warlock.js/auth` reads
 * it (current `auth.accessToken.*` / `auth.refreshToken.*` keys first, then the
 * deprecated `auth.jwt.*` block), and never imports that package.
 *
 * OPTS OUT when auth is not in use: no `auth.userType` configured, or
 * `@warlock.js/auth` not installed in the project. A missing secret is left to
 * the `jwt-secret` check.
 */
export const authTokensCheck: DoctorCheck = warnOnError({
  name: "auth-tokens",
  run: () => {
    const userType: unknown = config.get("auth.userType");

    const authInUse =
      typeof userType === "object" && userType !== null && Object.keys(userType).length > 0;

    if (!authInUse || !isInstalledInProject("@warlock.js/auth")) return undefined;

    const findings = [
      secretFinding("accessToken.secret", "jwt.secret"),
      secretFinding("refreshToken.secret", "jwt.refresh.secret"),
      lifetimeFinding(),
    ].filter((finding): finding is string => finding !== undefined);

    if (findings.length === 0) {
      return {
        name: "auth-tokens",
        status: "ok",
        detail: "signing secrets and access-token lifetime are within safe bounds",
      };
    }

    return {
      name: "auth-tokens",
      status: "warn",
      detail:
        findings.length === 1
          ? (findings[0] ?? "")
          : `${findings.length} token settings to change:\n` +
            findings.map((finding) => `  - ${finding}`).join("\n"),
    };
  },
});
