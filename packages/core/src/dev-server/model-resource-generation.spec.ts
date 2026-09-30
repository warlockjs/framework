import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FilesOrchestrator as FilesOrchestratorType } from "./files-orchestrator";
import type { TypeGenerator as TypeGeneratorType } from "./type-generator";

/**
 * `TypeGenerator.generateAll` emits `.warlock/typings/model-resources.d.ts`, the
 * `ModelResourceRegistry` augmentation that lets `Serialized<Model>` resolve to a
 * resource. The fixture app covers the shapes that matter end to end: a
 * tsconfig alias import, a relative import, a default-exported model, a model
 * with no resource and one whose resource cannot be resolved statically.
 *
 * Modules are imported after `process.chdir` for the reason spelled out in
 * `type-generator.spec.ts`: both capture `process.cwd()` when first loaded.
 */
describe("TypeGenerator, model resource registry", () => {
  let tempRoot: string;
  let previousCwd: string;
  let filesOrchestrator: FilesOrchestratorType;
  let TypeGenerator: typeof TypeGeneratorType;

  const output = () => path.join(tempRoot, ".warlock/typings/model-resources.d.ts");

  const write = async (relative: string, contents: string) => {
    const target = path.join(tempRoot, relative);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf-8");
  };

  beforeAll(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-model-resources-"));
    process.chdir(tempRoot);

    ({ filesOrchestrator } = await import("./files-orchestrator"));
    ({ TypeGenerator } = await import("./type-generator"));
  }, 120_000);

  afterAll(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    filesOrchestrator.files.clear();
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });

    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "app/*": ["src/app/*"] } },
      }),
    );

    await write(
      "src/app/users/resources/user.resource.ts",
      `export const UserResource = { toJSON() { return { id: 1 }; } };`,
    );
    await write(
      "src/app/users/models/user.model.ts",
      `
        import { Model } from "@warlock.js/cascade";
        import { UserResource } from "../resources/user.resource";

        export class User extends Model {
          public static resource = UserResource;
        }
      `,
    );

    await write(
      "src/app/orders/resources/order.resource.ts",
      `export default class OrderResource { toJSON() { return { id: 1 }; } }`,
    );
    await write(
      "src/app/orders/models/order.model.ts",
      `
        import { Model } from "@warlock.js/cascade";
        import OrderWire from "app/orders/resources/order.resource";

        export default class Order extends Model {
          static readonly resource = OrderWire;
        }
      `,
    );

    await write(
      "src/app/tags/models/tag.model.ts",
      `
        import { Model } from "@warlock.js/cascade";
        import { lazy } from "@mongez/reinforcements";

        export class Tag extends Model {
          public static resource = lazy(() => import("./tag.resource"));
        }
      `,
    );
    await write(
      "src/app/tags/models/plain.model.ts",
      `
        import { Model } from "@warlock.js/cascade";

        export class Plain extends Model {}
      `,
    );
  });

  it("emits one sorted entry per model with a statically resolvable resource", async () => {
    await filesOrchestrator.initializeAll();
    await new TypeGenerator().generateAll();

    const content = await fs.readFile(output(), "utf-8");

    expect(content).toContain('import "@warlock.js/core";');
    expect(content).toContain(
      '    "Order": { model: import("../../src/app/orders/models/order.model").default; resource: typeof import("../../src/app/orders/resources/order.resource").default };',
    );
    expect(content).toContain(
      '    "User": { model: import("../../src/app/users/models/user.model").User; resource: typeof import("../../src/app/users/resources/user.resource").UserResource };',
    );
    expect(content.indexOf('"Order"')).toBeLessThan(content.indexOf('"User"'));
    expect(content).not.toContain('"Tag"');
    expect(content).not.toContain('"Plain"');
  });

  it("does not rewrite the file when nothing changed, and is byte-identical across runs", async () => {
    await filesOrchestrator.initializeAll();

    const generator = new TypeGenerator();

    await generator.generateAll();

    const first = await fs.readFile(output(), "utf-8");
    const firstStat = await fs.stat(output());

    await new Promise((resolve) => setTimeout(resolve, 25));
    await generator.generateAll();

    const secondStat = await fs.stat(output());

    expect(await fs.readFile(output(), "utf-8")).toBe(first);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("drops an entry on the next generation after its model loses the resource", async () => {
    await filesOrchestrator.initializeAll();

    const generator = new TypeGenerator();

    await generator.generateAll();
    expect(await fs.readFile(output(), "utf-8")).toContain('"User"');

    await fs.rm(path.join(tempRoot, "src/app/users/models/user.model.ts"));
    filesOrchestrator.files.delete("src/app/users/models/user.model.ts");

    await generator.generateAll();

    const content = await fs.readFile(output(), "utf-8");

    expect(content).not.toContain('"User"');
    expect(content).toContain('"Order"');
  });

  it("regenerates from a batch that touches a model or deletes a contributing file", async () => {
    await filesOrchestrator.initializeAll();

    const generator = new TypeGenerator();

    await generator.generateAll();
    await fs.rm(output());

    // Nothing relevant changed: no regeneration.
    await generator.executeTypingsGenerator(["src/app/tags/models/notes.txt"]);
    await expect(fs.stat(output())).rejects.toThrow();

    // A model file in the batch: regenerate.
    await generator.executeTypingsGenerator(["src/app/users/models/user.model.ts"]);
    expect(await fs.readFile(output(), "utf-8")).toContain('"User"');

    // A resource that contributed has vanished: regenerate.
    await fs.rm(output());
    filesOrchestrator.files.delete("src/app/users/resources/user.resource.ts");
    await generator.executeTypingsGenerator(["src/app/users/resources/user.resource.ts"]);
    expect(await fs.readFile(output(), "utf-8")).toBeTruthy();
  });
});
