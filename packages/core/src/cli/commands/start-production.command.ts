import { assertSitesRequireWebRole, parseRoles, parseSites } from "../../application/roles";
import { checkDistReadyToStartAsync } from "../../production/assert-dist-ready-to-start";
import { superviseProductionProcess } from "../../production/production-supervisor";
import { resolveBuildConfig } from "../../production/resolve-build-config";
import { command } from "../../commands/cli-command";

const NODE_FLAG_PATTERN =
  /^--(inspect(-brk|-wait)?(=.*)?|max-old-space-size=.*|enable-source-maps|trace-.*)$/;

/** `--role`/`--sites`, in both `--role=x` and `--role x` forms — recognised
 * here so they never leak into the child's app argv (they become
 * `WARLOCK_ROLES`/`WARLOCK_SITES` env vars instead). */
const ROLE_OPTION_PATTERN = /^--(role|sites)(=.*)?$/;

export const startProductionCommand = command({
  name: "start",
  description: "Start production server",
  persistent: true,
  preload: {
    warlockConfig: true,
  },
  action: async (data) => {
    // Validated BEFORE the dist check and the spawn: an unknown role or a
    // `--sites` without `web` is an operator mistake, and the sooner it fails
    // the less it looks like the build (or the child) is at fault.
    const roleOption = typeof data.options.role === "string" ? data.options.role : undefined;
    const sitesOption = typeof data.options.sites === "string" ? data.options.sites : undefined;

    let roles;
    let sites;

    try {
      roles = parseRoles(roleOption);
      sites = parseSites(sitesOption);
      assertSitesRequireWebRole(roles, sites);
    } catch (error) {
      console.error(`✖ ${(error as Error).message}`);
      process.exit(1);
      return;
    }

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

    // Recognised Node flags go BEFORE the entry file; everything else is app argv.
    // process.argv = [node, cli.ts, start, ...extra]
    const appArgs: string[] = [];
    const startIndex = process.argv.findIndex((arg) => arg === "start");
    if (startIndex !== -1 && startIndex < process.argv.length - 1) {
      const rest = process.argv.slice(startIndex + 1);

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i] as string;

        if (NODE_FLAG_PATTERN.test(arg)) {
          nodeArgs.push(arg);
          continue;
        }

        // `--role`/`--sites` are framework plumbing, resolved above into
        // `WARLOCK_ROLES`/`WARLOCK_SITES` — they must not also reach the
        // child as app argv.
        if (ROLE_OPTION_PATTERN.test(arg)) {
          const next = rest[i + 1];

          // `--role=x` already carries its value; `--role x` consumes the
          // following token too, unless it looks like another flag.
          if (!arg.includes("=") && next !== undefined && !next.startsWith("-")) {
            i++;
          }

          continue;
        }

        appArgs.push(arg);
      }
    }

    nodeArgs.push(entryPath, ...appArgs);

    // Progress goes to stderr, never stdout. Stdout carries exactly one claim —
    // "started" — so that whatever greps it cannot mistake an intention for an
    // outcome. The banner that used to print here, in `preAction`, printed
    // before the child had even been spawned.
    console.error(`🚀 Starting production server...\n`);

    const env: NodeJS.ProcessEnv = { ...process.env, WARLOCK_ROLES: [...roles].join(",") };

    if (sites) {
      env.WARLOCK_SITES = [...sites].join(",");
    }

    const { exitCode } = await superviseProductionProcess({ nodeArgs, env });

    process.exit(exitCode);
  },
  options: [
    {
      text: "--role",
      description: "Comma-separated roles to serve: api, web, worker. Defaults to every role.",
      type: "string",
    },
    {
      text: "--sites",
      description: "Comma-separated site keys to install pages for. Requires --role=web.",
      type: "string",
    },
  ],
});
