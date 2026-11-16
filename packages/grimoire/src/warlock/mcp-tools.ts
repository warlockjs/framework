/**
 * The Grimoire tools `warlock mcp` and `warlock dev --mcp` serve. Each tool
 * loads its code inside `run`, so registering them costs nothing at start.
 * Answers are the same JSON objects `--json` prints.
 */
import { inputSchema, type WarlockMcpContext, type WarlockMcpTool } from "@warlock.js/core";
import { explainGrimoireCode, GrimoireError, grimoireCodeDocsUrl } from "../codes";
import type { BookAdapter } from "../contracts/adapter";
import type { ScryQuery } from "../contracts/scry";
import type { WarlockAdapterOptions } from "./adapter";

/** The names of the tools, in the order they are listed. */
export const GRIMOIRE_MCP_TOOL_NAMES = [
  "grimoire_file",
  "grimoire_impact",
  "grimoire_route",
  "grimoire_feature",
  "grimoire_flow",
  "grimoire_search",
  "grimoire_check",
  "grimoire_build",
  "grimoire_release",
  "grimoire_explain",
] as const;

/** A Grimoire error as a tool error: the code, what failed, and what to do. */
function toolError(error: unknown): never {
  if (error instanceof GrimoireError) {
    const fix = explainGrimoireCode(error.code)?.fix;

    throw new Error(`${error.code}: ${error.message}${fix ? ` Fix: ${fix}` : ""}`);
  }

  throw error;
}

function text(input: Record<string, unknown>, name: string): string {
  const value = input[name];

  return typeof value === "string" ? value : "";
}

/** The tools for one MCP server. `adapterFor` is replaced in specs. */
export function createGrimoireMcpTools(
  context: Pick<WarlockMcpContext, "cwd" | "inspect">,
  options: WarlockAdapterOptions = {},
  adapterFor?: () => Promise<BookAdapter>,
): WarlockMcpTool[] {
  const root = context.cwd;
  let adapter: Promise<BookAdapter> | undefined;

  // The server's own inspect: `warlock mcp` boots once for every tool, `warlock dev --mcp` reads the live app.
  const loadAdapter = (): Promise<BookAdapter> => {
    adapter ??=
      adapterFor?.() ??
      import("./adapter").then(({ createWarlockAdapter }) =>
        createWarlockAdapter({ ...options, inspect: (_root, sections) => context.inspect(sections) }),
      );

    return adapter;
  };

  const ask = (query: (input: Record<string, unknown>) => Promise<ScryQuery> | ScryQuery) =>
    async (input: Record<string, unknown>): Promise<unknown> => {
      try {
        const { answer } = await import("./actions");

        return await answer(root, await loadAdapter(), await query(input));
      } catch (error) {
        return toolError(error);
      }
    };

  const scryParts = () => import("../scry");

  return [
    {
      name: "grimoire_file",
      description:
        "One source file from the Grimoire book: header sentence, owning feature and borrowers, flows that reach it, exports, imports, importers, routes, pages. Read-only; reads cached route facts and never boots the app.",
      input: inputSchema({ file: { type: "string", description: "Project-relative path (either separator)." } }, ["file"]),
      writes: false,
      run: ask((input) => ({ type: "file", file: text(input, "file") })),
    },
    {
      name: "grimoire_impact",
      description:
        "What a change to a file reaches: importers (direct and all), API routes, pages and screens, flows, features (owner and borrowers) and tests. Read-only.",
      input: inputSchema({ file: { type: "string", description: "Project-relative path of the file to change." } }, ["file"]),
      writes: false,
      run: ask((input) => ({ type: "impact", file: text(input, "file") })),
    },
    {
      name: "grimoire_route",
      description:
        "One HTTP route: handler and its file, routes file, middleware, guard, the files behind it and the flow steps that name it. Read-only.",
      input: inputSchema(
        {
          method: { type: "string", description: "HTTP method (GET, POST…)." },
          path: { type: "string", description: "Path as registered (/api/products/:id)." },
        },
        ["method", "path"],
      ),
      writes: false,
      run: ask(async (input) => {
        const { parseRouteText } = await scryParts();

        return { type: "route", ...parseRouteText(`${text(input, "method")} ${text(input, "path")}`) };
      }),
    },
    {
      name: "grimoire_feature",
      description:
        "One feature: README, flows with status, its book map (own, borrowed and unreached files, routes, pages), recent changes, open tasks and its check findings. Read-only.",
      input: inputSchema({ feature: { type: "string", description: "Feature id (folder under grimoire/features/)." } }, ["feature"]),
      writes: false,
      run: ask(async (input) => {
        const { parseFeatureText } = await scryParts();

        return { type: "feature", feature: parseFeatureText(text(input, "feature")) };
      }),
    },
    {
      name: "grimoire_flow",
      description:
        "One flow: steps with the files behind each, cases, criteria with their tests and last results (pass, fail, stale, not run, no test), where it is shown, history and findings. Read-only.",
      input: inputSchema({ flow: { type: "string", description: "<feature>/<flow>, like catalog/new-arrivals." } }, ["flow"]),
      writes: false,
      run: ask(async (input) => {
        const { parseFlowText } = await scryParts();

        return { type: "flow", ...parseFlowText(text(input, "flow")) };
      }),
    },
    {
      name: "grimoire_search",
      description:
        "Search the Grimoire by words: features, flows, blocks, pages, screens, routes, file paths, export names, header sentences and tasks, best match first. Read-only.",
      input: inputSchema(
        {
          text: { type: "string", description: "Words to look for, in any order." },
          limit: { type: "integer", description: "Most hits to return (default 20).", minimum: 1 },
        },
        ["text"],
      ),
      writes: false,
      run: ask((input) => {
        const limit = input.limit;

        return typeof limit === "number"
          ? { type: "search", text: text(input, "text"), limit }
          : { type: "search", text: text(input, "text") };
      }),
    },
    {
      name: "grimoire_check",
      description:
        "Run the Grimoire check: written names that point at nothing, files without a header or feature, criteria without tests, version and changelog problems. Findings on proposed work are marked expected. Read-only; uses cached route facts.",
      input: inputSchema({}),
      writes: false,
      run: async () => {
        try {
          const [{ openGrimoire }, { checkGrimoire }] = await Promise.all([import("../workspace"), import("../check")]);

          return checkGrimoire(await openGrimoire(root, await loadAdapter(), { routes: "cached" }));
        } catch (error) {
          return toolError(error);
        }
      },
    },
    {
      name: "grimoire_build",
      description:
        "Bring the generated book (grimoire/book, a git-ignored cache) up to date, reading the routes again when they changed. Writes no project file.",
      input: inputSchema({ force: { type: "boolean", description: "Rebuild every entry." } }),
      writes: false,
      run: async (input) => {
        try {
          const { runGrimoire } = await import("./pipeline");
          const loaded = await loadAdapter();
          const force = input.force === true;
          let run;
          let note: string | null = null;

          try {
            run = await runGrimoire(root, loaded, { routes: "fresh", force });
          } catch (error) {
            if (!(error instanceof GrimoireError) || error.code !== "GR8002") throw error;

            note = `${error.code}: ${error.message}`;
            run = await runGrimoire(root, loaded, { routes: "cached", force });
          }

          return {
            rebuilt: run.rebuilt,
            written: [...run.book.written, ...run.collected.written],
            removed: [...run.book.removed, ...run.collected.removed],
            routes: run.snapshot.routes,
            ...(note === null ? {} : { note }),
          };
        } catch (error) {
          return toolError(error);
        }
      },
    },
    {
      name: "grimoire_release",
      description:
        "Write the collected list of a release into grimoire/releases/<release>.md (between its markers; the agent writes the brief and stamps the changelog entries first). Writes a project file.",
      input: inputSchema({ release: { type: "string", description: "Release name, like 1.1.0." } }, ["release"]),
      writes: true,
      run: async (input) => {
        try {
          const [{ parseGrimoire }, { writeRelease }] = await Promise.all([import("../written"), import("../releases")]);
          const release = text(input, "release").trim();

          if (release === "" || /[\\/]/.test(release)) {
            throw new GrimoireError("GR9006", `Pass a release name like 1.1.0 (got ${JSON.stringify(release)}).`);
          }

          return await writeRelease(root, (await parseGrimoire(root)).written, release);
        } catch (error) {
          return toolError(error);
        }
      },
    },
    {
      name: "grimoire_explain",
      description: "What a Grimoire code (GR1001…GR9006) means, what to do, the skill that explains it and its docs link. Read-only.",
      input: inputSchema({ code: { type: "string", description: "The code, like GR2001." } }, ["code"]),
      writes: false,
      run: async (input) => {
        const definition = explainGrimoireCode(text(input, "code"));

        if (!definition) {
          throw new Error(
            `Unknown Grimoire code ${JSON.stringify(text(input, "code"))}. Codes look like GR2001; the full list is at the check guide.`,
          );
        }

        return { ...definition, docs: grimoireCodeDocsUrl(definition.code) };
      },
    },
  ];
}
