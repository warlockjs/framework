import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesOrchestrator } from "./files-orchestrator";
import { isLocaleFile } from "./special-file-patterns";

/**
 * FW-02: the boot file set came from a `.ts`/`.tsx` glob, so a module whose
 * only dictionary is `utils/locales.json` was never registered at boot and
 * `t()` printed raw keys until the watcher reported an edit to the file.
 */
describe("FilesOrchestrator.getAllFilesFromFilesystem — module locales.json (FW-02)", () => {
  let root: string;

  function write(relativePath: string, contents: string) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "warlock-fw02-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);

    write("src/app/posts/main.ts", "export {};\n");
    write("src/app/posts/utils/locales.json", '{ "title": { "en": "Posts" } }\n');
    write("src/app/members/utils/locales.json", "{}\n");
    // Not dictionaries: other JSON stays out of the dependency graph.
    write("src/app/posts/data/seed.json", "[]\n");
    write("src/app/posts/utils/nested/locales.json", "{}\n");
    write("src/config/app.json", "{}\n");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("includes every module's utils/locales.json alongside the code files", async () => {
    const files = await new FilesOrchestrator().getAllFilesFromFilesystem();

    expect(files).toContain("src/app/posts/main.ts");
    expect(files).toContain("src/app/posts/utils/locales.json");
    expect(files).toContain("src/app/members/utils/locales.json");
  });

  it("leaves other JSON files out", async () => {
    const files = await new FilesOrchestrator().getAllFilesFromFilesystem();

    expect(files).not.toContain("src/app/posts/data/seed.json");
    expect(files).not.toContain("src/app/posts/utils/nested/locales.json");
    expect(files).not.toContain("src/config/app.json");
  });

  it("only adds JSON files the special-files collector classifies as locales", async () => {
    const files = await new FilesOrchestrator().getAllFilesFromFilesystem();
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    expect(jsonFiles.length).toBe(2);
    expect(jsonFiles.every((file) => isLocaleFile(file))).toBe(true);
  });

  it("lists each file once", async () => {
    const files = await new FilesOrchestrator().getAllFilesFromFilesystem();

    expect(new Set(files).size).toBe(files.length);
  });
});
