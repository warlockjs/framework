import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesOrchestrator } from "./files-orchestrator";

/**
 * A project that lives under a dot-directory (`.claude/worktrees/<name>`, a
 * hidden CI workspace) must boot with the same file set as any other path.
 */
describe("FilesOrchestrator.getAllFilesFromFilesystem — project under a dot-directory", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "warlock-dot-"));
    const root = path.join(base, ".hidden", "worktrees", "app.v2 (copy) [1]");

    mkdirSync(path.join(root, "src/app/posts"), { recursive: true });
    writeFileSync(path.join(root, "src/app/posts/routes.ts"), "export {};\n");
    writeFileSync(path.join(root, "src/app/posts/main.ts"), "export {};\n");
    vi.spyOn(process, "cwd").mockReturnValue(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(base, { recursive: true, force: true });
  });

  it("finds the module files", async () => {
    const files = await new FilesOrchestrator().getAllFilesFromFilesystem();

    expect(files.sort()).toEqual(["src/app/posts/main.ts", "src/app/posts/routes.ts"]);
  });
});
