import { updateWarlockPackages } from "../../updater/update-warlock-packages";
import { command } from "../cli-command";

export const updateCommand = command({
  name: "update",
  description: "Update all @warlock.js packages in this project to their latest version",
  action: async (data) => {
    // `parseCliArgs` camelCases every flag, so `--no-install` arrives as
    // `options.noInstall` (not `options["no-install"]`).
    await updateWarlockPackages({
      install: !data.options.noInstall,
    });
  },
  options: [
    {
      text: "--no-install",
      description:
        "Rewrite the @warlock.js versions in package.json without running the package manager install",
      type: "boolean",
    },
  ],
});
