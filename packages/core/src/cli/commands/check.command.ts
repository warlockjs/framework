import { command } from "../../commands/cli-command";
import { checkCommandAction } from "./check/check-command.action";

/**
 * `warlock check` — the single verify command: typecheck, lint (the app's
 * Oxlint config), the tests affected by the change, and framework
 * convention checks, reported as one problem list. Exit 0 clean, 1 problems
 * in the code, 2 problems with this machine.
 *
 * No preload: the steps read files and run tools; nothing boots, connects or
 * binds a port, so `check` behaves the same with or without a database or
 * Redis running.
 */
export const checkCommand = command({
  name: "check",
  description:
    "Typecheck, lint, run the affected tests and check conventions; one problem list, exit 1 for your code and 2 for this machine",
  action: checkCommandAction,
  options: [
    {
      text: "--lint",
      description: "Lint tool: oxlint (default)",
      type: "string",
    },
    {
      text: "--changed, -c",
      description:
        "Only the files changed against HEAD (plus untracked files) and what they affect",
      type: "boolean",
    },
    {
      text: "--base, -b",
      description: "Compare with the merge base of this ref instead of HEAD (implies --changed)",
      type: "string",
    },
    {
      text: "--skip, -s",
      description:
        "Comma-separated steps to skip: environment, typecheck, lint, tests, conventions",
      type: "string",
    },
    {
      text: "--project, -p",
      description: "tsconfig path (default tsconfig.json)",
      type: "string",
    },
    {
      text: "--json, -j",
      description: "Print the report as JSON",
      type: "boolean",
    },
  ],
});
