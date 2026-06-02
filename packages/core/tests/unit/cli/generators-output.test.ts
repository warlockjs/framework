import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMigration } from "../../../src/cli/commands/generate/generators/migration.generator";
import { generateModule } from "../../../src/cli/commands/generate/generators/module.generator";
import { setDryRun } from "../../../src/cli/commands/generate/utils/writer";
import type { CommandActionData } from "../../../src/cli/types";

/**
 * End-to-end generator OUTPUT tests. The generators write under
 * `process.cwd()/src/app`, so each test chdir's into a throwaway temp dir,
 * runs the generator, and asserts the emitted files + their substituted
 * placeholders, then restores the cwd and deletes the temp tree.
 *
 * Only the generators that do NOT gate on `moduleExists` are driven
 * end-to-end here (module + migration). The module-gated generators
 * (controller/service/model/repository/resource) currently cannot reach
 * their write path — see generators-module-gate.test.ts.
 */
const data = (args: string[], options: CommandActionData["options"] = {}): CommandActionData => ({
  args,
  options,
});

const appPathFor = (...segments: string[]) =>
  path.join(process.cwd(), "src", "app", ...segments);

let tempDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-gen-"));
  process.chdir(tempDir);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  setDryRun(false);
  consoleSpy.mockRestore();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("generateModule — minimal", () => {
  beforeEach(async () => {
    await generateModule(data(["products"], { minimal: true }));
  });

  it("creates the module scaffold files", async () => {
    const main = await readFile(appPathFor("products", "main.ts"), "utf-8");
    const routes = await readFile(appPathFor("products", "routes.ts"), "utf-8");
    const locales = await readFile(appPathFor("products", "utils", "locales.ts"), "utf-8");

    expect(main).toContain("custom entry point");
    expect(routes).toContain('import { router } from "@warlock.js/core"');
    expect(locales).toContain('groupedTranslations("products"');
  });

  it("does NOT emit CRUD controllers in minimal mode", async () => {
    const controllers = await readdir(appPathFor("products", "controllers"));

    expect(controllers).toHaveLength(0);
  });
});

describe("generateModule — full CRUD (default)", () => {
  beforeEach(async () => {
    await generateModule(data(["products"]));
  });

  it("pluralizes the module name and singularizes the entity", async () => {
    const createController = await readFile(
      appPathFor("products", "controllers", "create-product.controller.ts"),
      "utf-8",
    );

    expect(createController).toContain("create-product.schema");
    expect(createController).toContain("createProductController");
  });

  it("scaffolds the five CRUD controllers", async () => {
    const controllers = await readdir(appPathFor("products", "controllers"));

    expect(controllers.sort()).toEqual(
      [
        "create-product.controller.ts",
        "delete-product.controller.ts",
        "get-product.controller.ts",
        "list-products.controller.ts",
        "update-product.controller.ts",
      ].sort(),
    );
  });

  it("emits the model with a plural snake table name", async () => {
    const model = await readFile(
      appPathFor("products", "models", "product", "product.model.ts"),
      "utf-8",
    );

    expect(model).toContain('public static table = "products"');
    expect(model).toContain("export class Product extends Model");
  });

  it("emits the CRUD routes wired to every controller", async () => {
    const routes = await readFile(appPathFor("products", "routes.ts"), "utf-8");

    expect(routes).toContain('.route("/products")');
    expect(routes).toContain(".list(listProductsController)");
    expect(routes).toContain(".destroy(deleteProductController)");
  });

  it("writes a timestamped migration file under the model folder", async () => {
    const migrations = await readdir(appPathFor("products", "models", "product", "migrations"));

    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatch(/-product\.migration\.ts$/);
  });
});

describe("generateModule — dry run", () => {
  it("writes nothing to disk when --dry-run is set", async () => {
    await generateModule(data(["products"], { dryRun: true }));

    await expect(readdir(appPathFor("products"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("generateMigration — create", () => {
  it("writes a Migration.create file for the model path", async () => {
    await generateMigration(data(["products/product"]));

    const dir = appPathFor("products", "models", "product", "migrations");
    const files = await readdir(dir);

    expect(files).toHaveLength(1);

    const content = await readFile(path.join(dir, files[0]), "utf-8");

    expect(content).toContain("export default Migration.create(Product, {");
  });

  it("rejects an invalid model path without writing", async () => {
    await generateMigration(data(["nopath"]));

    await expect(readdir(appPathFor("nopath"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("generateMigration — alter via column DSL", () => {
  it("emits a Migration.alter with the parsed add columns and imports", async () => {
    await generateMigration(
      data(["products/product"], { add: "sku:string:nullable,price:decimal" }),
    );

    const dir = appPathFor("products", "models", "product", "migrations");
    const files = await readdir(dir);
    const content = await readFile(path.join(dir, files[0]), "utf-8");

    expect(content).toContain("export default Migration.alter(Product, {");
    expect(content).toContain("add: {");
    expect(content).toContain("sku: string().nullable(),");
    expect(content).toContain("price: decimal(),");
    expect(content).toContain('import { Migration, string, decimal } from "@warlock.js/cascade"');
  });

  it("emits drop and rename sections from their DSL forms", async () => {
    await generateMigration(
      data(["products/product"], { drop: "legacy,old_flag", rename: "name:title" }),
    );

    const dir = appPathFor("products", "models", "product", "migrations");
    const files = await readdir(dir);
    const content = await readFile(path.join(dir, files[0]), "utf-8");

    expect(content).toContain('drop: ["legacy","old_flag"],');
    expect(content).toContain('"name": "title"');
  });
});
