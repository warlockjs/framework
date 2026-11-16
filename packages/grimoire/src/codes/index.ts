import type {
  GrimoireCodeDefinition,
  GrimoireFinding,
  GrimoireFindingInput,
} from "../contracts/findings";
import { GRIMOIRE_CODES, GRIMOIRE_CODE_LIST, type GrimoireCode } from "./codes";

export { GRIMOIRE_CODES, GRIMOIRE_CODE_LIST, type GrimoireCode };

/** Base URL of the code reference; each code is an anchor on that page. */
export const GRIMOIRE_CODES_DOCS_URL = "https://warlock.js.org/v/latest/grimoire/guides/04-check/";

/** Whether `value` is a registered Grimoire code. */
export function isGrimoireCode(value: unknown): value is GrimoireCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GRIMOIRE_CODES, value);
}

/**
 * The catalog entry for a code, or `undefined` for an unknown one. Case and
 * surrounding whitespace are ignored (`explainGrimoireCode(" gr2001 ")`).
 */
export function explainGrimoireCode(code: string): GrimoireCodeDefinition | undefined {
  const normalized = code.trim().toUpperCase();

  return isGrimoireCode(normalized) ? GRIMOIRE_CODES[normalized] : undefined;
}

/** The docs URL of a code. */
export function grimoireCodeDocsUrl(code: string): string {
  return `${GRIMOIRE_CODES_DOCS_URL}#${code.trim().toLowerCase()}`;
}

/**
 * Build a finding, filling `severity` and `hint` from the catalog. Throws on
 * an unknown code, so a rule cannot report a code nobody can look up.
 * `expected` starts `false`; `checkGrimoire()` sets it for proposed features
 * and flows.
 */
export function createFinding(input: GrimoireFindingInput): GrimoireFinding {
  const definition = explainGrimoireCode(input.code);

  if (!definition) throw new Error(`Unknown Grimoire code ${JSON.stringify(input.code)}.`);

  return {
    code: definition.code,
    severity: input.severity ?? definition.severity,
    message: input.message,
    at: input.at ?? null,
    expected: false,
    subject: {
      feature: input.feature ?? null,
      flow: input.flow ?? null,
      app: input.app ?? null,
      task: input.task ?? null,
      file: input.file ?? input.at?.file ?? null,
    },
    hint: definition.fix,
  };
}

/**
 * An error a command or query reports with a Grimoire code (`GR9001` for a
 * file not in the book, `GR9005` for a release with no brief). The CLI prints
 * the message and the code's fix, and exits 1.
 */
export class GrimoireError extends Error {
  public readonly code: GrimoireCode;

  public constructor(code: GrimoireCode, message: string) {
    super(message);
    this.name = "GrimoireError";
    this.code = code;
  }
}
