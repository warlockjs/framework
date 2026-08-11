import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression guard for `renderReact()` racing the react imports.
 *
 * `renderReact` is synchronous, but the modules it needs used to arrive through
 * two `await import()`s fired at module load. A `moduleExists` flag guarded the
 * call — except the flag is `null` while those imports are in flight, and `null`
 * is neither `false` nor a loaded module, so the guard let the call through and
 * `react` / `reactDomServer` were read while still `undefined`.
 *
 * **Why these tests spawn processes.** The window only exists on the first tick
 * of a fresh module graph. Any same-process Vitest test imports at collection
 * time and calls later, which is precisely the delay that hides the bug — this
 * is the lesson of the sibling defect in `image.ts`, whose in-process suite
 * stayed green against the live bug. So the guard must be a brand-new Node
 * process that imports and calls with nothing in between.
 *
 * **How the failure cases are staged.** Cases (b)-(e) need a `react` that is
 * absent, or present-but-broken, which cannot be arranged against the real
 * `node_modules` without mutating the workspace. Instead the module *source* is
 * copied into a temp directory next to a fixture `node_modules`. Resolution is
 * anchored to the importing file (`createRequire(import.meta.url)`, and
 * likewise for `import()`), so the copy resolves against the fixture while the
 * real tree is untouched. The limitation is that this exercises the source text
 * at a different path, not the file in place.
 *
 * **What is imported.** This checkout has no built artifact, so the spawned
 * processes import TypeScript **source** through `tsx`. That exercises the real
 * module-init ordering, but does not cover a packaging-level regression in the
 * built output.
 */

const repoRoot = path.resolve(__dirname, "../../../..");
const reactSource = path.resolve(__dirname, "../../../src/react/index.ts");

/** Absolute path → the `file:///` URL form a spawned ESM process can import. */
function toFileUrl(target: string): string {
  return `file:///${target.split(path.sep).join("/")}`;
}

/**
 * Run a snippet in a fresh Node ESM process and return its exit code + output.
 */
function runInFreshProcess(source: string) {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    );

    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    return {
      code: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const sandboxes: string[] = [];

/**
 * Copy the react module source into a temp directory that owns its own
 * `node_modules`, so the copy resolves `react` / `react-dom/server` against
 * fixtures instead of against the workspace.
 *
 * @param packages package name → files to write under `node_modules/<name>`
 * @returns the `file:///` URL of the copied module
 */
function sandbox(packages: Record<string, Record<string, string>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-react-resolution-"));
  sandboxes.push(dir);

  fs.copyFileSync(reactSource, path.join(dir, "react-module.ts"));

  for (const [name, files] of Object.entries(packages)) {
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(dir, "node_modules", name, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
  }

  return toFileUrl(path.join(dir, "react-module.ts"));
}

/** A `react` that resolves and works well enough to get past resolution. */
const workingReact = {
  "package.json": JSON.stringify({ name: "react", version: "19.0.0", main: "index.js" }),
  "index.js": "module.exports = { createElement: () => ({}) };",
};

/** A `react` that is installed but throws on load — a missing transitive dep. */
const brokenReact = {
  "package.json": JSON.stringify({ name: "react", version: "19.0.0", main: "index.js" }),
  "index.js": "require('react-missing-transitive');\nmodule.exports = {};",
};

/** A `react-dom` whose `./server` subpath is installed but throws on load. */
const brokenReactDomServer = {
  "package.json": JSON.stringify({
    name: "react-dom",
    version: "19.0.0",
    main: "index.js",
    exports: { ".": "./index.js", "./server": "./server.js" },
  }),
  "index.js": "module.exports = {};",
  "server.js": "require('react-dom-missing-transitive');\nmodule.exports = {};",
};

/**
 * Call `renderReact` in a sandbox and print the resulting error message.
 *
 * @param calls how many times to call — the second call is what proves the
 *   failure *reason* is cached, not merely the fact that resolution ran.
 */
function callAndReportError(moduleUrl: string, calls = 1): string {
  return (
    `import { renderReact } from ${JSON.stringify(moduleUrl)};` +
    `for (let i = 1; i <= ${calls}; i++) {` +
    `  try { renderReact(() => null); console.log("CALL " + i + " THREW NOTHING"); }` +
    `  catch (error) { console.log("CALL " + i + " ERROR: " + error.message.split("\\n")[0]); }` +
    `}`
  );
}

afterAll(() => {
  for (const dir of sandboxes) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("renderReact — react resolution is synchronous", () => {
  it("renders on the first tick after import in a fresh process", () => {
    const result = runInFreshProcess(
      `import { renderReact } from ${JSON.stringify(toFileUrl(reactSource))};` +
        `import { createElement } from "react";` +
        `const html = renderReact(() => createElement("div", null, "ok"));` +
        `console.log("HTML:" + html);`,
    );

    expect(result.stderr).not.toMatch(/Cannot read properties of undefined/);
    expect(result.stdout).toContain("HTML:<div>ok</div>");
    expect(result.code).toBe(0);
  }, 60_000);

  it("surfaces the original error when react is present but unloadable", () => {
    const result = runInFreshProcess(callAndReportError(sandbox({ react: brokenReact })));

    expect(result.stdout).toContain("react-missing-transitive");
    expect(result.stdout).not.toMatch(/react is not installed/);
    expect(result.code).toBe(0);
  }, 60_000);

  it("surfaces the original error on the second call too, not a fallback lie", () => {
    const result = runInFreshProcess(callAndReportError(sandbox({ react: brokenReact }), 2));

    const calls = result.stdout.trim().split(/\r?\n/);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("react-missing-transitive");
    expect(calls[1]).not.toMatch(/react is not installed/);
    expect(calls[1]).toBe(calls[0]?.replace("CALL 1", "CALL 2"));
    expect(result.code).toBe(0);
  }, 60_000);

  it("reports genuinely absent react with the install instructions", () => {
    const result = runInFreshProcess(callAndReportError(sandbox({})));

    expect(result.stdout).toContain("react is not installed.");
    expect(result.code).toBe(0);
  }, 60_000);

  it("names react-dom/server, not react, when react-dom/server is what failed", () => {
    const result = runInFreshProcess(
      callAndReportError(sandbox({ react: workingReact, "react-dom": brokenReactDomServer })),
    );

    expect(result.stdout).toContain("react-dom-missing-transitive");
    expect(result.stdout).toContain("react-dom/server");
    expect(result.stdout).not.toMatch(/^CALL \d+ ERROR: react is not installed/m);
    expect(result.code).toBe(0);
  }, 60_000);
});
