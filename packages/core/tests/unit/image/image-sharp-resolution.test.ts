import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for the `Image` constructor racing the sharp import.
 *
 * The constructor used to depend on an async `import("sharp")` fired at module
 * load. Between "module imported" and "sharp settled" the cached function was
 * still undefined, so constructing an `Image` immediately after importing the
 * package threw `TypeError: sharpFn is not a function`. Waiting ~100ms first
 * made it pass — the failure was purely a matter of timing.
 *
 * **Why this test spawns a process.** The window only exists in the first tick
 * of a fresh module graph. Any same-process Vitest test imports the module at
 * collection time and constructs later, which is exactly the delay that hides
 * the bug — the existing image suite even awaits `import("sharp")` in
 * `beforeAll`. So the guard has to be a brand-new Node process that imports and
 * constructs with nothing in between.
 *
 * **What is imported.** This checkout has no built artifact (`core/esm` is not
 * produced here), so the spawned process imports the TypeScript **source**
 * entry through `tsx`, not the published bundle. That still exercises the real
 * module-init ordering — the only thing the loader changes is how the file is
 * transpiled — but it does not cover a packaging-level regression in the built
 * output.
 */

const repoRoot = path.resolve(__dirname, "../../../..");
const imageEntry = path
  .resolve(__dirname, "../../../src/image/index.ts")
  .split(path.sep)
  .join("/");

/**
 * Run a snippet in a fresh Node ESM process and return its exit code + stderr.
 */
function runInFreshProcess(source: string) {
  try {
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    });

    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };

    return { code: failure.status ?? 1, stderr: failure.stderr ?? "" };
  }
}

describe("Image — sharp resolution is synchronous", () => {
  /**
   * A real 4x4 PNG on disk, so the file-path guard below can run an actual read
   * through the pipeline instead of only checking that a method exists.
   */
  let pngPath: string;

  beforeAll(async () => {
    const sharp = (await import("sharp")).default;

    pngPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "warlock-image-resolution-")),
      "red-4x4.png",
    );

    fs.writeFileSync(
      pngPath,
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
    );
  });

  afterAll(() => {
    fs.rmSync(path.dirname(pngPath), { recursive: true, force: true });
  });

  it("constructs immediately after import in a fresh process", () => {
    const result = runInFreshProcess(
      `import { Image } from ${JSON.stringify(`file:///${imageEntry}`)};` +
        `const image = new Image(Buffer.from([1]));` +
        `if (typeof image.image?.metadata !== "function") process.exit(3);`,
    );

    expect(result.stderr).not.toMatch(/is not a function/);
    expect(result.code).toBe(0);
  }, 60_000);

  /**
   * The path variant used to construct from `"does-not-need-to-exist.png"` and
   * assert only that nothing threw — which it could not, since sharp does not
   * touch the path until an operation runs, so the first test already covered
   * every way it could fail. It now reads a real file through the pipeline in
   * the same first tick: the resolved module has to be a *working* sharp, not
   * merely a defined function, and the string input has to reach it intact.
   */
  it("runs a real pipeline on a file path constructed in the first tick", () => {
    const result = runInFreshProcess(
      `import { Image } from ${JSON.stringify(`file:///${imageEntry}`)};` +
        `const image = Image.fromFile(${JSON.stringify(pngPath)});` +
        `const { width, height } = await image.dimensions();` +
        `if (width !== 4 || height !== 4) { console.error("got " + width + "x" + height); process.exit(3); }`,
    );

    expect(result.stderr).not.toMatch(/is not a function/);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  }, 60_000);
});
