import { addCommandAction } from "../../generations/add-command.action";
import { generationOutputOptions, runGenerationCommand } from "../../generations/generation-run";
import { command } from "../../commands/cli-command";

export const addCommand = command({
  name: "add <features...>",
  description: "Add new feature(s) to the project",
  preload: { config: ["app"], optionalWarlockConfig: true },
  action: (data) => runGenerationCommand("add", data, addCommandAction),
  options: [
    {
      text: "--package-manager, -pm",
      description: "Package manager to use, if not passed, it will be detected automatically",
    },
    {
      text: "--list, -l",
      description: "List available features",
      type: "boolean",
    },
    {
      text: "--no-install",
      description:
        "Record dependencies in package.json without installing them — still ejects configs, adds scripts, and runs setup hooks. Used by scaffolders that run a single install afterwards.",
      type: "boolean",
    },
    ...generationOutputOptions,
  ],
});
