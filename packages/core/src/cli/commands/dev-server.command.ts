import { checkForFrameworkUpdate } from "../../dev-server/check-for-updates";
import { startDevelopmentServer } from "../../dev-server/start-development-server";
import { isDevWorker, superviseDevServer } from "../../dev-server/supervisor";
import { command } from "../../commands/cli-command";
import { displayStartupBanner } from "../cli-commands.utils";

export const devServerCommand = command({
  name: "dev",
  description: "Start development server (HMR, type-gen, health checks)",
  persistent: true,
  preload: {
    runtimeStrategy: "development",
    // Overrides whatever NODE_ENV the shell exported. A shell with
    // NODE_ENV=production made Vite's dep optimiser pre-bundle the PRODUCTION
    // build of React, which silently suppresses hydration-mismatch warnings —
    // the dev server was hiding the exact class of bug it exists to surface.
    // Set here, in preload, because preloaders run before the action, and the
    // action is what eventually reaches Vite's `createServer`.
    environment: "development",
    config: true, // load all config
    bootstrap: true,
    prestart: true, // load prestart file (if exists)
    // Only the Early lifecycle phase starts here; the Late phase
    // (http, socket) starts after app modules load — see
    // development-server.ts STEP 8.5.
    connectors: true,
  },
  preAction: async () => {
    // Two roles share this command. The first `warlock dev` becomes a thin
    // supervisor that owns the terminal and (re)spawns the real server; the
    // process it spawns carries WARLOCK_DEV_WORKER and falls through to the
    // server itself. See supervisor.ts for why the split exists.
    //
    // This branch has to sit in `preAction`, which runs BEFORE the command's
    // preloaders: the supervisor must never load config or start connectors,
    // or it would hold a second database connection open for the whole
    // session. `superviseDevServer()` never resolves, so nothing below it —
    // preload included — runs in the supervisor.
    if (!isDevWorker()) {
      return superviseDevServer();
    }

    await displayStartupBanner({ environment: "development" });
  },
  action: async (data) => {
    const devServer = await startDevelopmentServer({
      fresh: Boolean(data.options.fresh),
      // Pass `false` only when the CLI flag is explicitly set; `undefined`
      // lets `warlock.config.ts > devServer.*` defaults apply.
      generateTypings: data.options.skipTypings ? false : undefined,
      healthCheckers: data.options.skipHealth ? false : undefined,
    });

    // Fire-and-forget: once the server is ready, surface a one-line notice if
    // a newer @warlock.js/core has been published, and arm the `u` shortcut
    // that updates + restarts. Fully self-guarded — it never blocks startup
    // nor breaks dev if the registry is unreachable.
    void checkForFrameworkUpdate(devServer);
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
