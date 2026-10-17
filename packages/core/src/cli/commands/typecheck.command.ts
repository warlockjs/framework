import { command } from "../../commands/cli-command";
import { typecheckCommandAction } from "./check/typecheck-command.action";

/**
 * `warlock typecheck` — incremental TypeScript check through the compiler
 * API, with `--changed` to limit it to the changed files and their importers.
 * The same problem shape and exit codes as `warlock check`. No preload.
 */
export const typecheckCommand = command({
  name: "typecheck",
  description:
    "Typecheck the project incrementally; --changed limits it to changed files and the files importing them",
  action: typecheckCommandAction,
  options: [
    {
      text: "--changed, -c",
      description: "Only the files changed against HEAD (plus untracked files) and their importers",
      type: "boolean",
    },
    {
      text: "--base, -b",
      description: "Compare with the merge base of this ref instead of HEAD (implies --changed)",
      type: "string",
    },
    {
      text: "--project, -p",
      description: "tsconfig path (default tsconfig.json)",
      type: "string",
    },
    {
      text: "--json, -j",
      description: "Print the result as JSON",
      type: "boolean",
    },
  ],
});
