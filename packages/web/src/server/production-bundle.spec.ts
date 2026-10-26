import esbuild from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The guard spelled out in `web-connector.ts`, `web-connector-factory.ts` and
 * `collect-sitemap-entries.ts` must make a production bundle leave out the
 * module behind it, and a development build keep it. This checks the
 * mechanism with the exact expression those files write.
 */
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-production-bundle-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src/dev-only.ts"),
    'export const marker = "DEV_ONLY_MODULE_BODY";\n',
  );
  writeFileSync(
    path.join(root, "src/entry.ts"),
    [
      "export async function load() {",
      "  if (!(globalThis as { __WARLOCK_PRODUCTION_BUNDLE__?: boolean }).__WARLOCK_PRODUCTION_BUNDLE__) {",
      '    return import("./dev-only");',
      "  }",
      '  throw new Error("not in production");',
      "}",
      "",
    ].join("\n"),
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function bundle(define: Record<string, string>): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [path.join(root, "src/entry.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    define,
    outfile: path.join(root, "out.js"),
  });

  return result.outputFiles[0]!.text;
}

describe("production bundle guard", () => {
  it("removes the guarded module when the marker is defined", async () => {
    const output = await bundle({ "globalThis.__WARLOCK_PRODUCTION_BUNDLE__": "true" });

    expect(output).not.toContain("DEV_ONLY_MODULE_BODY");
    expect(output).not.toContain("dev-only");
  });

  it("keeps the guarded module in a build without the marker", async () => {
    expect(await bundle({})).toContain("DEV_ONLY_MODULE_BODY");
  });
});
