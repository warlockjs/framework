import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { warnOnError } from "./config-values";

/** The retired-key settings, each with the live setting that replaced it. */
const rotationSettings = [
  "encryption.previousKeys",
  "auth.accessToken.previousSecrets",
  "auth.refreshToken.previousSecrets",
] as const;

/** Number of non-empty string entries in a retired-key list; 0 when absent or not a list. */
function countEntries(value: unknown): number {
  if (!Array.isArray(value)) return 0;

  return value.filter((entry) => typeof entry === "string" && entry !== "").length;
}

/**
 * Notes retired keys that are still configured: `encryption.previousKeys`,
 * `auth.accessToken.previousSecrets` and `auth.refreshToken.previousSecrets`.
 *
 * They exist to bridge a key rotation. Once nothing stored is still encrypted
 * with a retired key (and every token signed with a retired secret has
 * expired), each one only widens what an attacker holding an old key can open
 * or forge, so it should be removed.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when none is configured.
 */
export const keyRotationCheck: DoctorCheck = warnOnError({
  name: "key-rotation",
  run: () => {
    const configured = rotationSettings
      .map((setting) => ({ setting, count: countEntries(config.get(setting)) }))
      .filter((item) => item.count > 0);

    if (configured.length === 0) return undefined;

    const list = configured.map((item) => `${item.setting} (${item.count})`).join(", ");

    return {
      name: "key-rotation",
      status: "warn",
      code: "WL1019",
      detail:
        `retired keys are still configured: ${list}. They only bridge a rotation — remove each ` +
        "once nothing stored is still encrypted with it and every token signed with it has expired.",
    };
  },
});
