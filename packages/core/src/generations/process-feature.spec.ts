import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCommandAction, allowedFeatures } from "./add-command.action";
import { getWarlockVersion } from "../utils/framework-vesion";
import { beginGenerationRun, endGenerationRun } from "./generation-run";

let root: string;
let previous: string;
beforeEach(async () => {
  previous = process.cwd();
  root = await mkdtemp(path.join(tmpdir(), "warlock-add-process-"));
  process.chdir(root);
  await mkdir(path.join(root, "src/app"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "example-app", dependencies: {} }),
  );
  await writeFile(path.join(root, "src/app/main.ts"), "// application startup\n");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  endGenerationRun({ ok: true });
  process.chdir(previous);
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
const add = () => addCommandAction({ args: ["process"], options: { noInstall: true } });
const read = (file: string) => readFile(path.join(root, file), "utf8");

describe("warlock add process", () => {
  it("lists the feature, pins the family version and creates typed lifecycle wiring", async () => {
    expect(allowedFeatures).toContain("process");
    await add();
    expect(JSON.parse(await read("package.json")).dependencies["@warlock.js/process"]).toBe(
      await getWarlockVersion(),
    );
    expect(await read("src/config/process.ts")).toContain("satisfies SupervisorOptions");
    expect(await read("src/config/process.ts")).toContain(
      'registry: rootPath("storage/processes/registry.json")',
    );
    expect(await read("src/app/processes/index.ts")).toContain("supervisor(processConfig)");
    const hooks = await read("src/app/processes/lifecycle.ts");
    expect(hooks).toContain("Application.onValidateBoot");
    expect(hooks).toContain("await processes.recover()");
    expect(hooks).toContain("Application.onShutdown");
    expect(hooks).toContain("await processes.stopAll()");
    expect(await read("src/app/main.ts")).toBe(
      'import "./processes/lifecycle";\n// application startup\n',
    );
    expect(await read("src/app/processes/devtools.ts")).toContain("processes.list()");
  });

  it("is a second-run no-op and preserves app edits", async () => {
    await add();
    await writeFile(path.join(root, "src/config/process.ts"), "// configured by app\n");
    const files = [
      "package.json",
      "src/config/process.ts",
      "src/app/main.ts",
      "src/app/processes/index.ts",
      "src/app/processes/lifecycle.ts",
      "src/app/processes/devtools.ts",
    ];
    const before = await Promise.all(files.map(read));
    await add();
    expect(await Promise.all(files.map(read))).toEqual(before);
  });

  it("previews the dependency and every generated file without writing them", async () => {
    const originalPackage = await read("package.json");
    beginGenerationRun({ command: "add", dryRun: true });
    await add();
    const report = endGenerationRun({ ok: true });
    expect(report.written).toEqual(
      expect.arrayContaining([
        "package.json",
        "src/config/process.ts",
        "src/app/main.ts",
        "src/app/processes/index.ts",
        "src/app/processes/lifecycle.ts",
        "src/app/processes/devtools.ts",
      ]),
    );
    expect(await read("package.json")).toBe(originalPackage);
    expect(await read("src/app/main.ts")).toBe("// application startup\n");
    await expect(read("src/app/processes/index.ts")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps application edits to the exported supervisor and lifecycle", async () => {
    await mkdir(path.join(root, "src/app/processes"), { recursive: true });
    await writeFile(path.join(root, "src/app/processes/index.ts"), "// custom supervisor\n");
    await writeFile(path.join(root, "src/app/processes/lifecycle.ts"), "// custom lifecycle\n");
    await writeFile(path.join(root, "src/app/processes/devtools.ts"), "// custom panel\n");
    await add();
    expect(await read("src/app/processes/index.ts")).toBe("// custom supervisor\n");
    expect(await read("src/app/processes/lifecycle.ts")).toBe("// custom lifecycle\n");
    expect(await read("src/app/processes/devtools.ts")).toBe("// custom panel\n");
  });
});
