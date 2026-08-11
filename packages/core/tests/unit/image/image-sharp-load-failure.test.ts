import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards *what* `resolveSharp()` says when sharp cannot be used.
 *
 * sharp's most common real-world failure is **installed but unloadable** — the
 * wrong platform binary. sharp throws its own long, actionable message naming
 * the runtime and the fix. Reporting that as `sharp is not installed` sends the
 * operator to `npm install sharp`, which cannot help: a known failure told as a
 * different, wrong cause.
 *
 * Only genuine absence — `MODULE_NOT_FOUND` whose message names the specifier
 * `'sharp'` exactly — may produce the install hint. The code alone is not
 * enough: a dependency missing *inside* sharp reports `MODULE_NOT_FOUND` too.
 *
 * **Why these spawn processes.** The resolution outcome is cached in module
 * state for the life of the process, so each scenario needs a fresh module
 * graph, and the failure has to be injected before the first construction. The
 * `--import` hook patches `require("sharp")`; see `fixtures/sharp-load-failure-hook.mjs`.
 *
 * **Why each scenario constructs twice.** `sharpResolved` is set before the load
 * is attempted, so a second construction skips the try block entirely and falls
 * through to the `!sharpFn` branch. A cached *absence* is not enough — the
 * failure reason has to be replayed, or the wrong cause reappears one call later.
 */

const repoRoot = path.resolve(__dirname, "../../../..");

const toUrl = (absolutePath: string) => `file:///${absolutePath.split(path.sep).join("/")}`;

const imageEntry = path.resolve(__dirname, "../../../src/image/index.ts");
const hookEntry = path.resolve(__dirname, "fixtures/sharp-load-failure-hook.mjs");
const sharpLibEntry = path.resolve(repoRoot, "node_modules/sharp/lib/constructor.js");

type Attempt = { message: string; cause: string | null };

/**
 * Construct an `Image` twice in a fresh process whose `require("sharp")` fails
 * in the given way, and report what each construction threw.
 */
function constructTwiceWithFailingSharp(mode: "missing" | "transitive" | "unloadable") {
  const source =
    `import { Image } from ${JSON.stringify(toUrl(imageEntry))};` +
    `const attempt = () => {` +
    `  try { new Image(Buffer.from([1])); return { message: "<no error thrown>", cause: null }; }` +
    `  catch (error) { return { message: String(error.message), cause: error.cause ? String(error.cause.message) : null }; }` +
    `};` +
    `const first = attempt();` +
    `const second = attempt();` +
    `console.log(JSON.stringify({ first, second }));`;

  const stdout = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      toUrl(hookEntry),
      "--input-type=module",
      "--eval",
      source,
    ],
    {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        WARLOCK_SHARP_FAILURE: mode,
        WARLOCK_SHARP_LIB_ENTRY: sharpLibEntry,
      },
    },
  );

  return JSON.parse(stdout.trim().split("\n").pop() as string) as {
    first: Attempt;
    second: Attempt;
  };
}

describe("Image — sharp fails to load", () => {
  it("surfaces sharp's own error when sharp is installed but unloadable", () => {
    const { first } = constructTwiceWithFailingSharp("unloadable");

    expect(first.message).not.toMatch(/sharp is not installed/);
    expect(first.message).toMatch(/Could not load the "sharp" module using the win32-x64 runtime/);
    expect(first.message).toMatch(/Failed to load "sharp"/);
  }, 60_000);

  it("chains the original error as `cause` as well as inlining it", () => {
    const { first } = constructTwiceWithFailingSharp("unloadable");

    expect(first.cause).toMatch(/Could not load the "sharp" module/);
    expect(first.cause).toMatch(/See https:\/\/sharp\.pixelplumbing\.com\/install/);
  }, 60_000);

  it("still surfaces the original error on the second construction", () => {
    const { first, second } = constructTwiceWithFailingSharp("unloadable");

    expect(second.message).not.toMatch(/sharp is not installed/);
    expect(second.message).toMatch(/Could not load the "sharp" module using the win32-x64 runtime/);
    expect(second.message).toBe(first.message);
    expect(second.cause).toBe(first.cause);
  }, 60_000);

  it("treats a MODULE_NOT_FOUND for a specifier other than sharp as a load failure", () => {
    const { first, second } = constructTwiceWithFailingSharp("transitive");

    expect(first.message).not.toMatch(/sharp is not installed/);
    expect(first.message).toMatch(/Failed to load "sharp": Cannot find module 'color'/);
    expect(second.message).toBe(first.message);
  }, 60_000);

  it("keeps the install instructions for a genuinely absent sharp", () => {
    const { first, second } = constructTwiceWithFailingSharp("missing");

    expect(first.message).toBe(
      "sharp is not installed.\n\n" +
        `Image processing requires the sharp package.
Install it with:

  warlock add image

Or manually:

  npm install sharp
  pnpm add sharp
  yarn add sharp`,
    );
    expect(first.cause).toBeNull();
    expect(second.message).toBe(first.message);
  }, 60_000);
});
