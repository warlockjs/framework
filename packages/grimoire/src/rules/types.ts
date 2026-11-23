import type { CodeRuleName } from "../contracts/settings";

/** One place a rule found, before the file is attached. */
export type RuleHit = { line: number; column: number; message: string };

/** One finding of a code rule in a file. */
export type RuleFinding = RuleHit & {
  rule: CodeRuleName;
  /** The finding code: `GR3007`–`GR3010`. */
  code: string;
};
