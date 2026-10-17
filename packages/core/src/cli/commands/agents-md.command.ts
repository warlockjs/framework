import { command } from "../../commands/cli-command";
import { agentsMdCommandAction } from "./agents-md/agents-md-command.action";

/**
 * `warlock agents-md` — render the app-specific AGENTS.md section from the
 * booted app (modules, routes, models, conventions, installed skills, verify
 * commands). Prints it; `--write` puts it between the
 * `<!-- warlock:generated:start -->` / `end` markers of AGENTS.md, creating
 * the file when missing and never touching content outside the markers.
 *
 * Boots like `warlock inspect`: connectors boot but none starts, so no
 * connection opens and no port binds.
 */
export const agentsMdCommand = command({
  name: "agents-md",
  description:
    "Generate the app-specific AGENTS.md section from the booted app; --write updates it between its markers",
  action: agentsMdCommandAction,
  preload: {
    runtimeStrategy: "development",
    config: true,
    env: true,
    bootstrap: true,
  },
  options: [
    {
      text: "--write, -w",
      description:
        "Write the section into AGENTS.md between its markers (creates the file when missing)",
      type: "boolean",
    },
    {
      text: "--json, -j",
      description: "Print { file, status, section } as JSON",
      type: "boolean",
    },
  ],
});
