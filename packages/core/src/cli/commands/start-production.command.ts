import { checkDistReadyToStartAsync } from "../../production/assert-dist-ready-to-start";
import { superviseProductionProcess } from "../../production/production-supervisor";
import { resolveBuildConfig } from "../../production/resolve-build-config";
import { command } from "../../commands/cli-command";

export const startProductionCommand = command({
  name: "start",
  description: "Start production server",
  persistent: true,
  preload: {
    warlockConfig: true,
  },
  action: async () => {
    const { entryPath, sourcemap, outdir } = resolveBuildConfig();

    // Refuse a `dist` that did not come from a successful `warlock build` —
    // named explicitly, rather than failing later and incidentally because
    // some file the server happens to need (the client manifest, say) is
    // missing. See `assert-dist-ready-to-start.ts`.
    const readiness = await checkDistReadyToStartAsync(outdir);

    if (!readiness.ready) {
      console.error(`✖ ${readiness.reason}`);
      process.exit(1);
      return;
    }

    // Build node args
    const nodeArgs: string[] = [];

    // Enable source maps if configured
    if (sourcemap !== false) {
      nodeArgs.push("--enable-source-maps");
    }

    // Add entry file
    nodeArgs.push(entryPath);

    // Pass through any additional flags after "start" command
    // process.argv = [node, cli.ts, start, ...extra]
    const startIndex = process.argv.findIndex((arg) => arg === "start");
    if (startIndex !== -1 && startIndex < process.argv.length - 1) {
      const extraArgs = process.argv.slice(startIndex + 1);
      nodeArgs.push(...extraArgs);
    }

    // Progress goes to stderr, never stdout. Stdout carries exactly one claim —
    // "started" — so that whatever greps it cannot mistake an intention for an
    // outcome. The banner that used to print here, in `preAction`, printed
    // before the child had even been spawned.
    console.error(`🚀 Starting production server...\n`);

    const { exitCode } = await superviseProductionProcess({ nodeArgs });

    process.exit(exitCode);
  },
});
