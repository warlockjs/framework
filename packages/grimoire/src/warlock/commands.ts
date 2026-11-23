/**
 * The `warlock grimoire` and `warlock scry` commands. Light on purpose: the
 * work lives in `./actions`, imported when a command runs.
 */
import {
  command,
  withExplainCodes,
  withMcpTools,
  type CLICommand,
  type CLICommandPreload,
} from "@warlock.js/core";
import { explainGrimoireCode, grimoireCodeDocsUrl } from "../codes";
import type { BookAdapter } from "../contracts/adapter";
import type { WarlockAdapterOptions } from "./adapter";
import { createGrimoireMcpTools } from "./mcp-tools";

/** The preload of a command that reads routes: the `warlock inspect` boot. */
const BOOT: CLICommandPreload = {
  runtimeStrategy: "development",
  config: true,
  env: true,
  bootstrap: true,
};

/** No boot, but a multi-site app's `src/config/web.ts` (its sites' base paths shape the page routes). */
const WEB_CONFIG: CLICommandPreload = { config: ["web"] };

/** The preload of a question that boots only when `boot` says so. */
async function preloadFor(boot: () => Promise<boolean>): Promise<CLICommandPreload | undefined> {
  try {
    const actions = await import("./actions");

    if (await boot()) return BOOT;

    return (await actions.isMultiSite(process.cwd())) ? WEB_CONFIG : undefined;
  } catch {
    // The action runs the same steps and reports the problem with its code.
    return undefined;
  }
}

const GRIMOIRE_ACTIONS = ["build", "check", "release", "guard", "approve", "reject"] as const;

/** Print with the stream's own write, so a boot that moves `console.log` never mixes into the answer. */
const io = {
  out: (line: string) => void process.stdout.write(`${line}\n`),
  err: (line: string) => void process.stderr.write(`${line}\n`),
};

/** Exit with `code` once stdout and stderr are flushed (a non-zero code only; 0 lets the CLI finish). */
async function exitWith(code: number): Promise<void> {
  if (code === 0) return;

  process.exitCode = code;

  await Promise.race([
    Promise.all(
      [process.stdout, process.stderr].map(
        (stream) => new Promise<void>((resolve) => stream.write("", () => resolve())),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 500).unref()),
  ]);

  process.exit(code);
}

/** Explain a Grimoire code for `warlock explain GR2001`. */
function explainCode(code: string) {
  const definition = explainGrimoireCode(code);

  return definition
    ? {
        code: definition.code,
        title: definition.title,
        area: definition.area,
        fix: definition.fix,
        skill: definition.skill,
        docs: grimoireCodeDocsUrl(definition.code),
      }
    : undefined;
}

/**
 * The `grimoire <action> [name]` and `scry [file]` commands, with the
 * Grimoire MCP tools and the `GRnnnn` explainer attached. `cli.commands`
 * accepts this array as one entry.
 *
 * @example
 * // warlock.config.ts
 * export default defineConfig({ cli: { commands: [registerGrimoireCommands()] } });
 */
export function registerGrimoireCommands(options: WarlockAdapterOptions = {}): CLICommand[] {
  let adapter: Promise<BookAdapter> | undefined;
  const loadAdapter = (): Promise<BookAdapter> => {
    adapter ??= import("./adapter").then(({ createWarlockAdapter }) =>
      createWarlockAdapter(options),
    );

    return adapter;
  };
  const context = async () => ({ root: process.cwd(), adapter: await loadAdapter(), io });

  const grimoire: CLICommand = command({
    name: "grimoire <action> [name]",
    description:
      "Grimoire (experimental): build the book (build [--force] [--site [--product] [--out <dir>]]), check the written files (check [--all]), collect a release (release <version> [--stamp]), check a change against its task (guard [task] [--base <ref>] [--commits <range>]), approve or reject a change (approve|reject <id|feature/flow|api> [--all]); --json for JSON",
    preAction: async ({ args, options: flags }) => {
      grimoire.commandPreload = undefined;

      // guard, approve and reject read the cached route facts: they never boot the app.
      if (args[0] === "guard" || args[0] === "approve" || args[0] === "reject") {
        const preload = await preloadFor(async () => false);

        if (preload) grimoire.commandPreload = preload;

        return;
      }

      if (args[0] !== "build" && args[0] !== "check") return;

      const preload = await preloadFor(async () =>
        (await import("./actions")).needsBoot(process.cwd(), flags.force === true),
      );

      if (preload) grimoire.commandPreload = preload;
    },
    action: async ({ args, options: flags }) => {
      const actions = await import("./actions");
      const ctx = await context();
      const [name, target] = args;
      let code: number;

      switch (name) {
        case "build":
          code = await actions.runBuild(ctx, flags);
          break;
        case "check":
          code = await actions.runCheck(ctx, flags);
          break;
        case "release":
          code =
            flags.stamp === true
              ? await (await import("./release-command")).runStampRelease(ctx, target, flags)
              : await actions.runRelease(ctx, target, flags);
          break;
        case "guard":
          code = await (await import("./guard-command")).runGuard(ctx, target, flags);
          break;
        case "approve":
          code =
            target === "api"
              ? await (await import("./api-command")).runApproveApi(ctx, flags)
              : await (await import("./approve-command")).runApprove(ctx, target, flags);
          break;
        case "reject":
          code = await (await import("./approve-command")).runReject(ctx, target, flags);
          break;
        default: {
          const { GrimoireError } = await import("../codes");

          code = actions.reportError(
            io,
            new GrimoireError(
              "GR9006",
              `Unknown action ${JSON.stringify(name ?? "")}. Use one of: ${GRIMOIRE_ACTIONS.join(", ")} (warlock grimoire build).`,
            ),
          );
        }
      }

      await exitWith(code);
    },
    options: [
      { text: "--json, -j", description: "Print the result as JSON", type: "boolean" },
      {
        text: "--all",
        description:
          "check: list every finding (text output groups warnings by code); approve, reject: every change not approved",
        type: "boolean",
      },
      {
        text: "--force, -f",
        description:
          "build: rebuild every book entry and read the routes again, and write the site even when it is up to date",
        type: "boolean",
      },
      {
        text: "--site",
        description: "build: also write the static Grimoire site (default grimoire/book/site)",
        type: "boolean",
      },
      {
        text: "--product",
        description:
          "build --site: export the share-safe Product map only (no file paths, test names or per-file answers; opens on the map)",
        type: "boolean",
      },
      {
        text: "--out",
        description: "build --site: the folder to write the site to (project-relative)",
        type: "string",
      },
      {
        text: "--stamp",
        description:
          "release: move every changelog's Unreleased entries under the release (version from package.json when omitted), write the release file, then collect",
        type: "boolean",
      },
      {
        text: "--date",
        description: "release --stamp: the release date, yyyy-mm-dd (default today)",
        type: "string",
      },
      {
        text: "--base",
        description:
          "guard: the git ref the change is compared with (default the merge base with the default branch)",
        type: "string",
      },
      {
        text: "--commits",
        description:
          "guard: a commit range (origin/main..HEAD); every commit must name its task, and the tasks it names are guarded",
        type: "string",
      },
      {
        text: "--hook",
        description:
          "guard: agent-hook mode, findings on stderr and exit code 2 when the change must not stop here",
        type: "boolean",
      },
      {
        text: "--lang",
        description: "approve, reject: only the images of this language",
        type: "string",
      },
      {
        text: "--note",
        description: "reject: why, in the owner's words",
        type: "string",
      },
    ],
  });

  const scry: CLICommand = command({
    name: "scry [file]",
    description:
      'Grimoire (experimental): ask the stored book about a file, --impact <file>, --route "<METHOD path>" (an API route or a page URL), --feature <id>, --flow <feature>/<flow> or --search "<text>" (pass the whole sentence; hits come in score order, --app limits to one app); --json for JSON. Reads only; run warlock grimoire build after editing',
    preAction: async ({ options: flags }) => {
      scry.commandPreload = undefined;

      // scry only reads the stored book: it never boots the app (a multi-site app still loads its web config).
      const preload = await preloadFor(async () => false);

      if (preload) scry.commandPreload = preload;
    },
    action: async ({ args, options: flags }) => {
      const { runScry } = await import("./actions");

      await exitWith(await runScry(await context(), args, flags));
    },
    options: [
      { text: "--impact", description: "What a change to this file reaches", type: "string" },
      {
        text: "--route",
        description:
          'One route or page URL: "<METHOD> <path>" (GET and HEAD also find pages and screens)',
        type: "string",
      },
      { text: "--site", description: "--route: only the page of this site or app", type: "string" },
      { text: "--feature", description: "One feature by id", type: "string" },
      { text: "--flow", description: "One flow: <feature>/<flow>", type: "string" },
      {
        text: "--search",
        description:
          "Search by a sentence (a commit title, a bug report) or words; names first, then best match",
        type: "string",
      },
      { text: "--app", description: "--search: only hits of this app", type: "string" },
      { text: "--limit", description: "--search: most hits (default 20)", type: "number" },
      {
        text: "--all",
        description: "--impact: print every line of every list (text output stops at 20)",
        type: "boolean",
      },
      { text: "--json, -j", description: "Print the answer as JSON", type: "boolean" },
    ],
  });

  withMcpTools(grimoire, [(mcp) => createGrimoireMcpTools(mcp, options)]);
  withExplainCodes(grimoire, explainCode);

  return [grimoire, scry];
}
