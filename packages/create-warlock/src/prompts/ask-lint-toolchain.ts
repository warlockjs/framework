import { select } from "@clack/prompts";
import type { LintToolchain } from "../commands/create-new-app/types";

/** The full wizard offers the same toolchain choice as --lint. */
export function askLintToolchain(initialValue: LintToolchain = "oxc") {
  return select<LintToolchain>({
    message: "Choose lint and formatting tools",
    options: [
      { value: "eslint", label: "ESLint + Prettier" },
      { value: "oxc", label: "Oxlint + Oxfmt" },
    ],
    initialValue,
  });
}
