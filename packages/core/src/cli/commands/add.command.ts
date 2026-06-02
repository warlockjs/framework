import { addCommandAction } from "../../generations/add-command.action";
import { command } from "../cli-command";

export const addCommand = command({
  name: "add <features...>",
  description: "Add new feature(s) to the project",
  action: addCommandAction,
  options: [
    {
      text: "--package-manager -pm",
      description: "Package manager to use, if not passed, it will be detected automatically",
    },
    {
      text: "--list, -l",
      description: "List available features",
    },
    {
      text: "--no-install",
      description:
        "Record dependencies in package.json without installing them — still ejects configs, adds scripts, and runs setup hooks. Pass it last, after the feature list. Used by scaffolders that run a single install afterwards.",
    },
  ],
});
