import { startDevelopmentServer } from "../../dev-server/start-development-server";
import { command } from "../cli-command";
import { displayStartupBanner } from "../cli-commands.utils";

export const devServerCommand = command({
  name: "dev",
  description: "Start development server (HMR, type-gen, health checks)",
  persistent: true,
  preload: {
    runtimeStrategy: "development",
    config: true, // load all config
    bootstrap: true,
    prestart: true, // load prestart file (if exists)
    // Only the Early lifecycle phase starts here; the Late phase
    // (http, socket) starts after app modules load — see
    // development-server.ts STEP 8.5.
    connectors: true,
  },
  preAction: async () => {
    await displayStartupBanner({ environment: "development" });
  },
  action: async (data) => {
    await startDevelopmentServer({
      fresh: Boolean(data.options.fresh),
      // Pass `false` only when the CLI flag is explicitly set; `undefined`
      // lets `warlock.config.ts > devServer.*` defaults apply.
      generateTypings: data.options["skip-typings"] ? false : undefined,
      healthCheckers: data.options["skip-health"] ? false : undefined,
    });
  },
  options: [
    {
      text: "--fresh, -f",
      description: "Delete .warlock/manifest.json before start (force full re-parse from disk)",
      type: "boolean",
    },
    {
      text: "--skip-typings, -st",
      description: "Skip background type generation for this run",
      type: "boolean",
    },
    {
      text: "--skip-health, -sh",
      description: "Skip file health checkers for this run",
      type: "boolean",
    },
  ],
});
