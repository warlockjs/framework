import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { manifestPath } from "../dev-server/flags";
import { loadTestAppModules } from "./load-test-app-modules";

const originalCwd = process.cwd();
let workspace: string;

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A project under a dot-directory, the way a git worktree inside `.claude/` sits. */
function createProject(): string {
  const root = path.join(workspace, ".claude", "worktrees", "feature (one) [x]", "app");

  write(root, "package.json", JSON.stringify({ name: "fixture", type: "module" }));
  write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022" } }));
  write(root, "src/app/blog/routes.ts", "export const loaded = 'routes';\n");
  write(root, "src/app/blog/main.ts", "export const loaded = 'main';\n");

  return root;
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "warlock-test-modules-"));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workspace, { recursive: true, force: true });
});

describe("loadTestAppModules", () => {
  it("classifies and imports route and main files of a project inside a dot-directory", async () => {
    const root = createProject();

    process.chdir(root);
    await filesOrchestrator.init({ skipLoader: true });

    const imported: string[] = [];

    await loadTestAppModules(async (url) => {
      imported.push(path.relative(root, fileURLToPath(url)).split(path.sep).join("/"));

      return {};
    });

    expect(imported).toEqual(["src/app/blog/main.ts", "src/app/blog/routes.ts"]);
  });

  it("loads the same modules when a boot manifest from an earlier run is on disk", async () => {
    const root = createProject();

    process.chdir(root);
    await filesOrchestrator.init({ skipLoader: true });
    await filesOrchestrator.initializeAll();
    filesOrchestrator.files.clear();

    const imported: string[] = [];

    await loadTestAppModules(async (url) => {
      imported.push(path.basename(fileURLToPath(url)));

      return {};
    });

    expect(imported.sort()).toEqual(["main.ts", "routes.ts"]);
  });

  it("resolves the boot manifest from the current directory, not the import-time one", async () => {
    const root = createProject();

    process.chdir(root);

    expect(manifestPath()).toBe(path.join(process.cwd(), ".warlock", "manifest.json"));
  });

  it("throws, naming the project, when the project has modules the load did not see", async () => {
    const root = createProject();

    process.chdir(root);
    await filesOrchestrator.init({ skipLoader: true });

    const initializeAll = filesOrchestrator.initializeAll.bind(filesOrchestrator);

    // A list that was built before the modules existed: nothing gets discovered.
    filesOrchestrator.initializeAll = async () => {
      filesOrchestrator.files.clear();
    };

    try {
      await expect(loadTestAppModules(async () => ({}))).rejects.toThrow(
        /found no route or main files/,
      );
    } finally {
      filesOrchestrator.initializeAll = initializeAll;
    }
  });
});
