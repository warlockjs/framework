import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Schemes refused by default: a link with one of them runs script or reads
 * local files when it is opened or fetched.
 */
const SCRIPT_CAPABLE_PROTOCOLS = ["javascript:", "data:", "vbscript:", "file:"];

/** `"https"`, `"HTTPS:"` → `"https:"` (the form `URL#protocol` reports) */
function normalizeProtocol(protocol: string): string {
  const lower = protocol.trim().toLowerCase();
  return lower.endsWith(":") ? lower : `${lower}:`;
}

/**
 * URL rule - validates URL format
 *
 * Without options every scheme `URL` can parse is accepted except the
 * script-capable ones (`javascript:`, `data:`, `vbscript:`, `file:`).
 * With `protocols`, only the listed schemes are accepted.
 */
export const urlRule: SchemaRule<{ protocols?: string[] }> = {
  name: "url",
  defaultErrorMessage: "The :input must be a valid URL",
  async validate(value: any, context) {
    let protocol: string;

    try {
      protocol = new URL(value).protocol;
    } catch {
      return invalidRule(this, context);
    }

    const allowed = this.context.options.protocols;
    const accepted = allowed
      ? allowed.some((item) => normalizeProtocol(item) === protocol)
      : !SCRIPT_CAPABLE_PROTOCOLS.includes(protocol);

    return accepted ? VALID_RULE : invalidRule(this, context);
  },
};
