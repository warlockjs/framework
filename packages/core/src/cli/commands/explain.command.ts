import { command } from "../../commands/cli-command";
import { explainCommandAction } from "./explain/explain-command.action";

/**
 * `warlock explain [code]` — print what a stable Warlock error code (`WL3001`)
 * means, what to do about it, the skill that covers it and its docs link.
 * Without an argument it lists every code. A code of an installed package
 * (`GR2001`) is answered by the explainer its commands registered in
 * `cli.commands`; only `warlock.config.ts` is read. File explanations boot
 * read-only to discover route/page entry points; error codes read a static table.
 */
export const explainCommand = command({
  name: "explain [code-or-file]",
  description:
    "Explain a source file and its routes/pages, or an error code (e.g. WL3001, or a package code such as GR2001)",
  action: explainCommandAction,
  preAction: ({ args }) => {
    const requested = args[0]?.trim();
    if (requested && /^WL\d+$/i.test(requested)) {
      explainCommand.commandPreload = undefined;
    } else if (requested && /^[A-Z]{2}\d{4}$/i.test(requested)) {
      // A package code: only `warlock.config.ts` is needed to find its explainer.
      explainCommand.commandPreload = { warlockConfig: true };
    } else {
      explainCommand.commandPreload = {
        runtimeStrategy: "development",
        config: true,
        env: true,
        bootstrap: true,
      };
    }
  },
  options: [
    {
      text: "--json, -j",
      description: "Print the explanation as JSON",
      type: "boolean",
    },
  ],
});
