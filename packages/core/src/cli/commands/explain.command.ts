import { command } from "../../commands/cli-command";
import { explainCommandAction } from "./explain/explain-command.action";

/**
 * `warlock explain [code]` — print what a stable Warlock error code (`WL3001`)
 * means, what to do about it, the skill that covers it and its docs link.
 * Without a code it lists every code. Reads a static table: no preload.
 */
export const explainCommand = command({
  name: "explain [code]",
  description: "Explain a Warlock error code (e.g. WL3001): what it means and how to fix it",
  action: explainCommandAction,
  options: [
    {
      text: "--json, -j",
      description: "Print the registry entry as JSON",
      type: "boolean",
    },
  ],
});
