import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

// ESLint's RuleTester registers its cases through these hooks.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** A RuleTester that parses TypeScript and TSX, as Warlock apps are written. */
export function createRuleTester(): RuleTester {
  return new RuleTester({
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
}
