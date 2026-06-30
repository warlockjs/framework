import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";

/**
 * Config sections that a typical Warlock HTTP application is expected to
 * register. A missing section here is release/runtime-blocking, so absence is
 * a `fail` rather than a warning.
 */
const REQUIRED_CONFIG_SECTIONS = ["app", "http"] as const;

/**
 * `@mongez/config` returns `null` (not `undefined`) for an unregistered key,
 * so treat both nullish values as "missing".
 */
function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * Verifies that the required top-level config sections are present. Reads each
 * section via `config.get` only — never mutates configuration.
 */
export const configCheck: DoctorCheck = {
  name: "config",
  run: () => {
    const missing = REQUIRED_CONFIG_SECTIONS.filter((section) => {
      return !isPresent(config.get(section));
    });

    if (missing.length > 0) {
      return {
        name: "config",
        status: "fail",
        detail: `missing required config section(s): ${missing.join(", ")}`,
      };
    }

    return {
      name: "config",
      status: "ok",
      detail: `required sections present (${REQUIRED_CONFIG_SECTIONS.join(", ")})`,
    };
  },
};
