import { describe, expect, it } from "vitest";
import { Name } from "../../../src/cli/commands/generate/utils/name-parser";
import {
  controllerStub,
  crudModelStub,
  migrationAlterStub,
  migrationStub,
  modelStub,
  schemaStub,
  serviceStub,
} from "../../../src/cli/commands/generate/templates/stubs";

/**
 * Unit coverage for the generator templates — the pure functions that turn a
 * parsed `Name` into source text. Asserts the case-variant placeholders land
 * in the right spots and that option flags toggle the right branches.
 */
describe("serviceStub", () => {
  it("emits a camelCase service function for the name", () => {
    const output = serviceStub(new Name("create-user"));

    expect(output).toContain("export async function createUserService(data: any)");
    expect(output).toContain('throw new Error("createUserService not implemented")');
  });
});

describe("schemaStub", () => {
  it("emits a v.object schema and its inferred type", () => {
    const output = schemaStub(new Name("create-user"));

    expect(output).toContain('import { type Infer, v } from "@warlock.js/seal"');
    expect(output).toContain("export const createUserSchema = v.object({");
    expect(output).toContain("export type CreateUserSchema = Infer<typeof createUserSchema>");
  });
});

describe("controllerStub", () => {
  it("emits a plain guarded handler without validation", () => {
    const output = controllerStub(new Name("create-user"));

    expect(output).toContain("export const createUserController: GuardedRequestHandler =");
    expect(output).not.toContain(".validation");
  });

  it("binds the schema type and value when validation is requested", () => {
    const output = controllerStub(new Name("create-user"), { withValidation: true });

    expect(output).toContain(
      'import { type CreateUserSchema, createUserSchema } from "../schema/create-user.schema"',
    );
    expect(output).toContain("GuardedRequestHandler<CreateUserSchema>");
    expect(output).toContain("createUserController.validation = {");
    expect(output).toContain("schema: createUserSchema,");
  });
});

describe("modelStub", () => {
  it("derives the table name from the plural snake form by default", () => {
    const output = modelStub(new Name("product"));

    expect(output).toContain('public static table = "products"');
    expect(output).toContain("export class Product extends Model<ProductType>");
  });

  it("honors an explicit table name", () => {
    const output = modelStub(new Name("product"), { tableName: "catalog_items" });

    expect(output).toContain('public static table = "catalog_items"');
  });

  it("wires the resource import and static only when withResource is set", () => {
    const withResource = modelStub(new Name("product"), { withResource: true });
    const without = modelStub(new Name("product"), { withResource: false });

    expect(withResource).toContain("import { ProductResource }");
    expect(withResource).toContain("public static resource = ProductResource;");
    expect(without).not.toContain("ProductResource");
  });

  it("imports v and Infer from seal (core re-exports neither) and Model from cascade", () => {
    const output = modelStub(new Name("product"));

    expect(output).toContain('import { v, type Infer } from "@warlock.js/seal"');
    expect(output).toContain('import { Model, type StrictMode } from "@warlock.js/cascade"');
    // The broken pre-fix import must be gone — core never exported v / Infer.
    expect(output).not.toContain('from "@warlock.js/core"');
  });
});

describe("crudModelStub", () => {
  it("imports v and Infer from seal and the model base from cascade", () => {
    const output = crudModelStub(new Name("product"));

    expect(output).toContain('import { type Infer, v } from "@warlock.js/seal"');
    expect(output).toContain('import { Model, RegisterModel } from "@warlock.js/cascade"');
    // v / Infer must never resolve to core — it exports neither.
    expect(output).not.toContain('v } from "@warlock.js/core"');
    expect(output).not.toContain('{ type Infer, v } from "@warlock.js/core"');
  });

  it("emits a registered model with schema, table, and resource wiring", () => {
    const output = crudModelStub(new Name("product"));

    expect(output).toContain("@RegisterModel()");
    expect(output).toContain("export class Product extends Model<ProductSchema>");
    expect(output).toContain('public static table = "products"');
    expect(output).toContain("export type ProductSchema = Infer.Output<typeof productSchema>");
  });
});

describe("migrationStub", () => {
  it("emits a Migration.create for the entity with a placeholder body", () => {
    const output = migrationStub(new Name("product"));

    expect(output).toContain('import { Migration } from "@warlock.js/cascade"');
    expect(output).toContain('import { Product } from "../product.model"');
    expect(output).toContain("export default Migration.create(Product, {");
    expect(output).toContain("// add your columns here");
  });

  it("inlines provided columns instead of the placeholder", () => {
    const output = migrationStub(new Name("product"), { columns: "  price: decimal()," });

    expect(output).toContain("price: decimal(),");
    expect(output).not.toContain("// add your columns here");
  });

  it("appends the timestamps:false option object when disabled", () => {
    const output = migrationStub(new Name("product"), { timestamps: false });

    expect(output).toContain("{ timestamps: false }");
  });

  it("merges extra imports into the cascade import line", () => {
    const output = migrationStub(new Name("product"), { imports: ["decimal", "text"] });

    expect(output).toContain('import { Migration, decimal, text } from "@warlock.js/cascade"');
  });
});

describe("migrationAlterStub", () => {
  it("emits a Migration.alter with add/drop/rename sections", () => {
    const output = migrationAlterStub(new Name("product"), {
      add: "    sku: string(),",
      drop: '["legacy"]',
      rename: '{ old: "new" }',
      imports: ["string"],
    });

    expect(output).toContain("export default Migration.alter(Product, {");
    expect(output).toContain("add: {");
    expect(output).toContain("sku: string(),");
    expect(output).toContain('drop: ["legacy"],');
    expect(output).toContain('rename: { old: "new" },');
    expect(output).toContain('import { Migration, string } from "@warlock.js/cascade"');
  });
});
