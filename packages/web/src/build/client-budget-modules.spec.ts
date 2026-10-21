import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientBudgetModules } from "./client-budget-report";

describe("clientBudgetModules on the installed bundler", () => {
  let root: string;
  let output: Rollup.RollupOutput;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "warlock-budget-modules-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src/entry.ts"),
      'import { feature } from "./feature";\nexport const entry = () => feature() + "entry";\n',
    );
    await writeFile(
      path.join(root, "src/feature.ts"),
      `export const feature = () => "${"f".repeat(400)}";\n`,
    );
    const result = await build({
      root,
      logLevel: "silent",
      configFile: false,
      plugins: [clientBudgetModules(root)],
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.join(root, "src/entry.ts"),
          formats: ["es"],
          fileName: () => "entry.js",
        },
      },
    });
    output = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports every module of each chunk with a positive rendered size and an app-relative id", () => {
    const asset = output.output.find((file) => file.fileName === ".vite/budget-modules.json");
    expect(asset?.type).toBe("asset");

    const chunks = JSON.parse(String((asset as Rollup.OutputAsset).source)) as Record<
      string,
      { id: string; bytes: number }[]
    >;
    const modules = chunks["entry.js"] ?? [];

    expect(modules.map((module) => module.id).sort()).toEqual(["src/entry.ts", "src/feature.ts"]);
    for (const module of modules) expect(module.bytes).toBeGreaterThan(0);
    expect(modules.find((module) => module.id === "src/feature.ts")?.bytes).toBeGreaterThan(400);
  });
});
