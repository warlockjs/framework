/**
 * The `ScryError` of a failed question: what `warlock scry --json` prints on
 * stdout and what the scry MCP tools return as their error text.
 */
import { explainGrimoireCode, type GrimoireError } from "../codes";
import type { ScryError } from "../contracts/scry";

/** The code, the message and the code's fix text (`""` when it has none). */
export function scryErrorOf(error: GrimoireError): ScryError {
  return {
    type: "error",
    code: error.code,
    message: error.message,
    fix: explainGrimoireCode(error.code)?.fix ?? "",
  };
}
