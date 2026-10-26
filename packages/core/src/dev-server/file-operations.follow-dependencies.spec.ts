import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesOrchestrator } from "./files-orchestrator";

/**
 * A config file may import application code (a hook that calls a service, a
 * dynamic `import()` inside it). Loading the config must register the config
 * itself and its direct import edges, not walk every module the hook can reach:
 * that walk grows with the whole application and runs again in every test
 * worker.
 */
describe("adding a config file without following its dependencies", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "warlock-config-deps-"));
    mkdirSync(path.join(root, "src/config"), { recursive: true });
    mkdirSync(path.join(root, "src/app/orders"), { recursive: true });
    writeFileSync(
      path.join(root, "src/app/orders/tracker.service.ts"),
      'import { deep } from "./deep.service";\nexport const track = () => deep();\n',
    );
    writeFileSync(
      path.join(root, "src/app/orders/deep.service.ts"),
      "export const deep = () => 1;\n",
    );
    writeFileSync(
      path.join(root, "src/config/web.ts"),
      [
        "export default {",
        "  errors: {",
        "    report: async () => {",
        '      const { track } = await import("../app/orders/tracker.service");',
        "      track();",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
  });

  afterEach(() => {
    filesOrchestrator.getFiles().clear();
    vi.restoreAllMocks();
  });

  it("registers the config and its direct edges, nothing the hook reaches", async () => {
    const file = await filesOrchestrator.add("src/config/web.ts", { followDependencies: false });

    expect([...file.dependencies]).toEqual(["src/app/orders/tracker.service.ts"]);
    expect(filesOrchestrator.getFiles().has("src/config/web.ts")).toBe(true);
    expect(filesOrchestrator.getFiles().has("src/app/orders/tracker.service.ts")).toBe(false);
    expect(filesOrchestrator.getFiles().has("src/app/orders/deep.service.ts")).toBe(false);
  });

  it("still walks the graph by default, as the dev server relies on", async () => {
    await filesOrchestrator.add("src/config/web.ts");

    expect(filesOrchestrator.getFiles().has("src/app/orders/tracker.service.ts")).toBe(true);
    expect(filesOrchestrator.getFiles().has("src/app/orders/deep.service.ts")).toBe(true);
  });
});
