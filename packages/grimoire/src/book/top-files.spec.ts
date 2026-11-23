import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BookAdapter } from "../contracts/adapter";
import { buildBook, checkBook } from "./build";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-top-files-"));

  roots.push(root);
  mkdirSync(path.join(root, "mobile", "app", "src"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "mobile", "app", "src", "home.tsx"), "export const home = 1;\n");
  writeFileSync(path.join(root, "mobile", "app", "App.tsx"), "export default 1;\n");
  writeFileSync(path.join(root, "mobile", "app", "metro.config.js"), "module.exports = {};\n");
  writeFileSync(path.join(root, "mobile", "app", "env.d.ts"), "declare const a: 1;\n");
  writeFileSync(path.join(root, "vitest.config.ts"), "export default {};\n");
  writeFileSync(path.join(root, "src", "main.ts"), "export const main = 1;\n");

  return root;
}

const adapter: BookAdapter = {
  name: "top-files",
  version: "1.0.0",
  sourceRoots: async () => ["src", "mobile/app/src"],
  files: async () => [],
};

describe("book freshness fingerprint: top-level files of a nested source root", () => {
  it("hashes code files next to a nested root, not tool configs, type shims or project root files", async () => {
    const root = project();
    const { book } = await buildBook(root, adapter);

    expect(Object.keys(book.manifest.files).sort()).toEqual([
      "mobile/app/App.tsx",
      "mobile/app/src/home.tsx",
      "src/main.ts",
    ]);
  });

  it("marks the book stale when only a top-level file changes, is added or is removed", async () => {
    const root = project();

    await buildBook(root, adapter);
    expect((await checkBook(root, adapter))?.changed).toEqual([]);

    writeFileSync(path.join(root, "mobile", "app", "App.tsx"), "export default 2; // edited\n");
    expect((await checkBook(root, adapter))?.changed).toEqual(["mobile/app/App.tsx"]);

    await buildBook(root, adapter);
    writeFileSync(path.join(root, "mobile", "app", "index.ts"), "export {};\n");
    expect((await checkBook(root, adapter))?.changed).toEqual(["mobile/app/index.ts"]);

    await buildBook(root, adapter);
    rmSync(path.join(root, "mobile", "app", "App.tsx"));
    expect((await checkBook(root, adapter))?.changed).toEqual(["mobile/app/App.tsx"]);
  });
});
