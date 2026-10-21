import { command } from "../../commands/cli-command";
import { explainCommandAction } from "./explain/explain-command.action";

/**
 * `warlock explain [code]` — print what a stable Warlock error code (`WL3001`)
 * means, what to do about it, the skill that covers it and its docs link.
 * Without an argument it lists every code. File explanations boot read-only
 * to discover route/page entry points; error codes read a static table.
 */
export const explainCommand = command({
  name: "explain [code-or-file]",
  description: "Explain a source file and its routes/pages, or a Warlock error code (e.g. WL3001)",
  action: explainCommandAction,
  preAction: ({ args }) => {
    const requested = args[0]?.trim();
    explainCommand.commandPreload =
      requested && !/^WL\d+$/i.test(requested)
        ? { runtimeStrategy: "development", config: true, env: true, bootstrap: true }
        : undefined;
  },
  options: [
    {
      text: "--json, -j",
      description: "Print the explanation as JSON",
      type: "boolean",
    },
  ],
});
