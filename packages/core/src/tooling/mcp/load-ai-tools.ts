import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
import { WarlockError } from "../../errors/warlock-error";

/** The install line printed when the MCP transport packages are missing. */
export const MCP_INSTALL_HINT = "npm install -D @warlock.js/ai-tools @warlock.js/ai";

/** The tool shape `ai.mcp.serve` consumes, built structurally (see `@warlock.js/ai`'s `ToolContract`). */
export type ServeToolContract = {
  name: string;
  description: string;
  input: unknown;
  execute(input: Record<string, unknown>): Promise<unknown>;
  invoke(
    raw: unknown,
    context?: unknown,
  ): Promise<{
    data?: unknown;
    error?: Error;
    usage: { input: number; output: number; total: number };
    report: Record<string, unknown>;
  }>;
};

/** The transport options of `ai.mcp.serve` this command uses. */
export type ServeTransportOptions =
  | { type: "stdio" }
  | {
      type: "http";
      host: string;
      port: number;
      path: string;
      auth?: { bearer: string };
    };

/** The handle `start()` resolves. */
export type ServeHandle = { url?: string; close(): Promise<void> };

/** The slice of `@warlock.js/ai-tools` this command calls. */
export type AiToolsServeModule = {
  serve(
    tools: ServeToolContract[],
    options: { name: string; version?: string; transport: ServeTransportOptions },
  ): { start(): Promise<ServeHandle>; stop(): Promise<void> };
};

/** Whether a loaded module exposes `serve()`. */
export function isAiToolsServeModule(value: unknown): value is AiToolsServeModule {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "serve") === "function"
  );
}

function isMissingModule(error: unknown, names: readonly string[]): boolean {
  if (typeof error !== "object" || error === null) return false;

  const code = Reflect.get(error, "code");
  const message = error instanceof Error ? error.message : "";

  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    names.some((name) => message.includes(`'${name}'`) || message.includes(`"${name}"`))
  );
}

const PACKAGES = ["@warlock.js/ai-tools", "@warlock.js/ai"] as const;

/**
 * Import `@warlock.js/ai-tools` lazily — it is an optional peer, so a project
 * that never runs `warlock mcp` does not need it. Tries core's own resolution
 * first (pnpm links installed peers next to core), then the app's.
 *
 * Throws `WL7003` with the install line when it (or `@warlock.js/ai`, which
 * it imports) is missing.
 */
export async function loadAiToolsServe(
  cwd: string,
  importer: (specifier: string) => Promise<unknown> = (specifier) => import(specifier),
): Promise<AiToolsServeModule> {
  const attempts: (() => Promise<unknown>)[] = [
    () => importer("@warlock.js/ai-tools"),
    () =>
      importer(
        resolveModule("@warlock.js/ai-tools", pathToFileURL(path.join(cwd, "package.json")).href),
      ),
  ];
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const module = await attempt();

      if (isAiToolsServeModule(module)) return module;

      lastError = new Error("@warlock.js/ai-tools does not export serve()");
    } catch (error) {
      lastError = error;

      if (
        !isMissingModule(error, PACKAGES) &&
        !(error instanceof Error && /Cannot find package/.test(error.message))
      ) {
        break;
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);

  throw new WarlockError(
    "WL7003",
    `warlock mcp needs @warlock.js/ai-tools (and @warlock.js/ai), which could not be loaded: ${reason}. Install them: ${MCP_INSTALL_HINT}`,
    { cause: lastError },
  );
}
