import { config } from "../../../../config/config-getter";
import type { CheckStatus, DoctorCheck } from "../check.types";

/**
 * A non-empty string, or `undefined`. A secret arrives from `env(...)`; an
 * unset variable yields `undefined` and a `.env` line with nothing after the
 * `=` yields `""` — both are "not configured".
 */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Fails when the app has configured auth but no JWT signing secret is set.
 *
 * WHY THIS EXISTS. `authConfig.accessToken.secret()` throws "no JWT secret
 * configured" — but LAZILY, the first time a token is signed (a login). A fresh
 * scaffold's `src/config/auth.ts` reads `env("JWT_SECRET")`, and a fresh `.env`
 * has none, so the app BOOTS clean and then 500s on the very first login, with
 * the real message going only to server stderr (finding 7b606e38). `doctor`
 * turns that first-login surprise into a pre-flight failure that names the fix.
 *
 * NEEDS NO BOOTED APP — it reads config only, like `optional-peers`.
 *
 * OPTS OUT when auth is not in use. The signal is `auth.userType`: the config
 * an app fills in to declare its authenticatable models (`{ user: User }`). An
 * app with no userType configured is not doing auth, so a missing secret is not
 * a finding for it — silence keeps the doctor's false-positive budget intact.
 *
 * The secret is resolved from BOTH the current key (`auth.accessToken.secret`)
 * and the legacy one (`auth.jwt.secret`) the scaffold still emits, so this does
 * not fire on a project that is simply using the older, still-supported shape.
 */
export const jwtSecretCheck: DoctorCheck = {
  name: "jwt-secret",
  run: () => {
    const userType = config.get("auth.userType");

    const authInUse =
      typeof userType === "object" && userType !== null && Object.keys(userType).length > 0;

    if (!authInUse) return undefined;

    const secret =
      text(config.get("auth.accessToken.secret")) ?? text(config.get("auth.jwt.secret"));

    const status: CheckStatus = secret ? "ok" : "fail";

    if (secret) {
      return { name: "jwt-secret", status, detail: "A JWT signing secret is configured." };
    }

    return {
      name: "jwt-secret",
      status,
      detail:
        "auth is configured (auth.userType) but no JWT signing secret is set — " +
        "every login and token operation will fail with a generic 500. " +
        "Run `warlock jwt.generate` to create one, or set `auth.accessToken.secret`.",
    };
  },
};
