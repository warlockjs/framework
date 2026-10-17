/**
 * Which JavaScript runtime is executing this process, and what that means for
 * the CLI commands that only work on one of them.
 *
 * Bun and Deno both run Node programs through their Node compatibility layers,
 * and both announce themselves the same way: they keep `process.versions.node`
 * (the Node version they emulate) and add their own entry —
 * `process.versions.bun` (Bun's documented check,
 * https://bun.sh/guides/util/detect-bun) and `process.versions.deno`
 * (observed on Deno 2.9.7, the version the runtime CI job pins). Reading those
 * entries is therefore the one check that works from inside all three
 * runtimes without touching a runtime-specific global.
 */

/** The runtimes Warlock knows how to name. */
export type JavaScriptRuntimeName = "node" | "bun" | "deno";

export type JavaScriptRuntime = {
  /** Which runtime is executing this process. */
  type: JavaScriptRuntimeName;
  /** That runtime's own version (for Bun and Deno, not the Node version they emulate). */
  version: string;
};

/** Where the supported-runtimes matrix is documented. */
export const SUPPORTED_RUNTIMES_DOCS_URL =
  "https://warlock.js.org/v/latest/core/digging-deeper/supported-runtimes/";

const RUNTIME_LABELS: Record<JavaScriptRuntimeName, string> = {
  node: "Node.js",
  bun: "Bun",
  deno: "Deno",
};

/**
 * Detect the runtime executing this process.
 *
 * @param versions the `process.versions` to read; injectable for tests.
 */
export function detectJavaScriptRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): JavaScriptRuntime {
  const bunVersion = versions.bun;

  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return { type: "bun", version: bunVersion };
  }

  const denoVersion = versions.deno;

  if (typeof denoVersion === "string" && denoVersion.length > 0) {
    return { type: "deno", version: denoVersion };
  }

  return { type: "node", version: versions.node };
}

/** `"Bun 1.4.3"`, `"Deno 2.9.7"`, `"Node.js 22.15.0"`. */
export function describeJavaScriptRuntime(runtime: JavaScriptRuntime): string {
  return `${RUNTIME_LABELS[runtime.type]} ${runtime.version}`;
}

/**
 * The error a Node-only CLI command prints when it is started on Bun or Deno,
 * or `undefined` when the runtime is Node and the command may run.
 *
 * Only `warlock dev` is Node-only today: it compiles TypeScript and reloads
 * modules through Node's module customization hooks, which Bun does not
 * provide and Deno provides only partially. The production build runs anywhere
 * the compatibility layers reach, so the message points there.
 */
export function nodeOnlyCommandError(
  commandName: string,
  runtime: JavaScriptRuntime = detectJavaScriptRuntime(),
): string | undefined {
  if (runtime.type === "node") {
    return undefined;
  }

  return [
    `✖ warlock ${commandName} runs on Node.js only — this process is ${describeJavaScriptRuntime(runtime)}.`,
    `  The development server compiles TypeScript and hot-reloads modules through Node's module loader hooks.`,
    `  Run it with Node.js 22.15 or newer: npx warlock ${commandName}`,
    `  ${RUNTIME_LABELS[runtime.type]} can run the production build: build it with Node (npx warlock build),`,
    `  then start it with ${runtime.type === "bun" ? "bun dist/app.js" : "deno run -A dist/app.js"}.`,
    `  Supported runtimes: ${SUPPORTED_RUNTIMES_DOCS_URL}`,
  ].join("\n");
}

/**
 * Stop a Node-only command before it does any work when it runs on Bun or Deno.
 *
 * Exits with code 1 after printing {@link nodeOnlyCommandError} on stderr; a
 * no-op on Node.
 */
export function assertNodeOnlyCommand(
  commandName: string,
  runtime: JavaScriptRuntime = detectJavaScriptRuntime(),
): void {
  const message = nodeOnlyCommandError(commandName, runtime);

  if (message === undefined) {
    return;
  }

  console.error(message);
  process.exit(1);
}

/**
 * The note `warlock build` prints when it runs on Bun or Deno, or `undefined`
 * on Node.
 *
 * Not an error: the build is plain esbuild and Vite work that the
 * compatibility layers handle, but only the Node build is verified in CI, so
 * the user is told which part of the pipeline is supported where.
 */
export function unverifiedBuildRuntimeNotice(
  runtime: JavaScriptRuntime = detectJavaScriptRuntime(),
): string | undefined {
  if (runtime.type === "node") {
    return undefined;
  }

  return [
    `! warlock build is verified on Node.js; this process is ${describeJavaScriptRuntime(runtime)}.`,
    `  Build with Node (npx warlock build) for a supported artifact. Starting the built app on ${RUNTIME_LABELS[runtime.type]} is supported.`,
    `  Supported runtimes: ${SUPPORTED_RUNTIMES_DOCS_URL}`,
  ].join("\n");
}
