import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignRegistryKeys,
  extractModelResourceEntries,
  renderModelResourceRegistry,
  writeFileIfChanged,
  type ModelResourceEntry,
} from "./model-resource-typings";

const APP = "/app/src/app/users";
const MODEL = `${APP}/models/user.model.ts`;
const RESOURCE_FILE = `${APP}/resources/user.resource.ts`;
const RESOURCE_TABLE = { "../resources/user.resource": RESOURCE_FILE };

/** Extract from an in-memory model source, resolving specifiers through a fixed table. */
function extract(source: string, table: Record<string, string> = {}) {
  return extractModelResourceEntries({
    source,
    absolutePath: MODEL,
    resolveImport: (specifier) => table[specifier],
  });
}

describe("extractModelResourceEntries", () => {
  it("resolves a named import", () => {
    const { entries, skipped } = extract(
      `
        import { Model } from "@warlock.js/cascade";
        import { UserResource } from "../resources/user.resource";

        export class User extends Model<UserData> {
          public static resource = UserResource;
        }
      `,
      RESOURCE_TABLE,
    );

    expect(skipped).toEqual([]);
    expect(entries).toEqual([
      {
        className: "User",
        modelFile: MODEL,
        modelExport: "User",
        resourceFile: RESOURCE_FILE,
        resourceExport: "UserResource",
      },
    ]);
  });

  it("resolves an aliased import to the original export name", () => {
    const { entries } = extract(
      `
        import { UserResource as Wire } from "app/users/resources/user.resource";

        export class User extends Model {
          static readonly resource = Wire;
        }
      `,
      { "app/users/resources/user.resource": RESOURCE_FILE },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceFile: RESOURCE_FILE,
      resourceExport: "UserResource",
    });
  });

  it("resolves a default import to the default export", () => {
    const { entries } = extract(
      `
        import UserResource from "../resources/user.resource";

        export class User extends Model {
          public static resource = UserResource;
        }
      `,
      RESOURCE_TABLE,
    );

    expect(entries[0]).toMatchObject({ resourceFile: RESOURCE_FILE, resourceExport: "default" });
  });

  it("reports a default-exported model as default, in every spelling", () => {
    const header = `import { UserResource } from "../resources/user.resource";`;

    const direct = extract(
      `${header}
        export default class User extends Model {
          static resource = UserResource;
        }`,
      RESOURCE_TABLE,
    );
    const assignment = extract(
      `${header}
        class User extends Model {
          static resource = UserResource;
        }
        export default User;`,
      RESOURCE_TABLE,
    );
    const specifier = extract(
      `${header}
        class User extends Model {
          static resource = UserResource;
        }
        export { User as default };`,
      RESOURCE_TABLE,
    );

    expect(direct.entries[0]?.modelExport).toBe("default");
    expect(assignment.entries[0]?.modelExport).toBe("default");
    expect(specifier.entries[0]?.modelExport).toBe("default");
  });

  it("follows a model exported under another name", () => {
    const { entries } = extract(
      `
        import { UserResource } from "../resources/user.resource";

        class User extends Model {
          static resource = UserResource;
        }

        export { User as AppUser };
      `,
      RESOURCE_TABLE,
    );

    expect(entries[0]).toMatchObject({ className: "User", modelExport: "AppUser" });
  });

  it("resolves a resource declared in the same file", () => {
    const { entries } = extract(`
      export const UserResource = defineResource({ schema: { id: "number" } });

      export class User extends Model {
        public static resource = UserResource;
      }
    `);

    expect(entries).toEqual([
      {
        className: "User",
        modelFile: MODEL,
        modelExport: "User",
        resourceFile: MODEL,
        resourceExport: "UserResource",
      },
    ]);
  });

  it("skips a same-file resource that is not exported", () => {
    const { entries, skipped } = extract(`
      const UserResource = defineResource({ schema: { id: "number" } });

      export class User extends Model {
        public static resource = UserResource;
      }
    `);

    expect(entries).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("skips an identifier that is neither imported nor declared", () => {
    const { entries, skipped } = extract(`
      export class User extends Model {
        public static resource = UserResource;
      }
    `);

    expect(entries).toEqual([]);
    expect(skipped[0]).toMatchObject({ className: "User" });
  });

  it("skips an import the resolver cannot place", () => {
    const { entries, skipped } = extract(`
      import { UserResource } from "some-package";

      export class User extends Model {
        public static resource = UserResource;
      }
    `);

    expect(entries).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("skips computed, call and conditional expressions", () => {
    const { entries, skipped } = extract(`
      import { lazy } from "@mongez/reinforcements";

      export class User extends Model {
        public static resource = lazy(() => UserResource);
      }

      export class Admin extends Model {
        public static resource = resources.admin;
      }

      export class Guest extends Model {
        public static resource = cond ? A : B;
      }
    `);

    expect(entries).toEqual([]);
    expect(skipped.map((item) => item.className)).toEqual(["User", "Admin", "Guest"]);
  });

  it("ignores models without a static resource and non-static members", () => {
    const { entries, skipped } = extract(
      `
        import { UserResource } from "../resources/user.resource";

        export class User extends Model {
          public resource = UserResource;
          static resourceColumns = ["id"];
          static other = UserResource;
        }

        export class Product extends Model {
          public static resource?: any;
        }
      `,
      RESOURCE_TABLE,
    );

    expect(entries).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("skips a model that is not exported and a generic model", () => {
    const { entries, skipped } = extract(
      `
        import { UserResource } from "../resources/user.resource";

        class Hidden extends Model {
          static resource = UserResource;
        }

        export class Generic<T> extends Model {
          static resource = UserResource;
        }
      `,
      RESOURCE_TABLE,
    );

    expect(entries).toEqual([]);
    expect(skipped.map((item) => item.className)).toEqual(["Hidden", "Generic"]);
  });

  it("reads several models from one file", () => {
    const { entries } = extract(
      `
        import { UserResource, AdminResource } from "../resources/user.resource";

        export class User extends Model {
          static resource = UserResource;
        }

        export class Admin extends Model {
          static resource = AdminResource;
        }
      `,
      RESOURCE_TABLE,
    );

    expect(entries.map((entry) => [entry.className, entry.resourceExport])).toEqual([
      ["User", "UserResource"],
      ["Admin", "AdminResource"],
    ]);
  });

  it("returns nothing for a file that never mentions a resource", () => {
    expect(extract("export class User extends Model {}")).toEqual({ entries: [], skipped: [] });
  });
});

function entry(className: string, modelFile: string): ModelResourceEntry {
  return {
    className,
    modelFile,
    modelExport: className,
    resourceFile: `/app/src/resources/${className.toLowerCase()}.resource.ts`,
    resourceExport: `${className}Resource`,
  };
}

describe("assignRegistryKeys", () => {
  it("suffixes duplicate class names deterministically, whatever the input order", () => {
    const a = entry("User", "/app/src/a/user.model.ts");
    const b = entry("User", "/app/src/b/user.model.ts");
    const c = entry("User", "/app/src/c/user.model.ts");
    const other = entry("Order", "/app/src/order.model.ts");

    const summarize = (entries: ModelResourceEntry[]) =>
      assignRegistryKeys(entries).map(({ key, entry: item }) => [key, item.modelFile]);

    expect(summarize([a, b, c, other])).toEqual([
      ["Order", "/app/src/order.model.ts"],
      ["User", "/app/src/a/user.model.ts"],
      ["User_2", "/app/src/b/user.model.ts"],
      ["User_3", "/app/src/c/user.model.ts"],
    ]);
    expect(summarize([c, other, a, b])).toEqual(summarize([a, b, c, other]));
  });

  it("never collides with a class literally named like a suffixed key", () => {
    const keys = assignRegistryKeys([
      entry("User_2", "/app/src/x.model.ts"),
      entry("User", "/app/src/a.model.ts"),
      entry("User", "/app/src/b.model.ts"),
    ]).map(({ key }) => key);

    expect(new Set(keys).size).toBe(3);
  });
});

describe("renderModelResourceRegistry", () => {
  const typings = "/app/.warlock/typings";

  it("renders sorted entries with import types relative to the typings folder", () => {
    const text = renderModelResourceRegistry(
      [
        entry("Zed", "/app/src/app/zed/zed.model.ts"),
        {
          className: "Audit",
          modelFile: "/app/src/app/audit/audit.model.tsx",
          modelExport: "default",
          resourceFile: "/app/src/app/audit/audit.resource.ts",
          resourceExport: "default",
        },
      ],
      typings,
    );

    expect(text).toContain('import "@warlock.js/core";');
    expect(text).toContain('declare module "@warlock.js/core" {');
    expect(text).toContain(
      '    "Audit": { model: import("../../src/app/audit/audit.model").default; resource: typeof import("../../src/app/audit/audit.resource").default };',
    );
    expect(text.indexOf('"Audit"')).toBeLessThan(text.indexOf('"Zed"'));
  });

  it("is identical for the same set of models in any order", () => {
    const models = [
      entry("B", "/app/src/b.model.ts"),
      entry("A", "/app/src/a.model.ts"),
      entry("A", "/app/src/z/a.model.ts"),
    ];

    expect(renderModelResourceRegistry([...models].reverse(), typings)).toBe(
      renderModelResourceRegistry(models, typings),
    );
  });

  it("renders a valid empty registry when no model has a resource", () => {
    expect(renderModelResourceRegistry([], typings)).toContain(
      "interface ModelResourceRegistry {\n\n  }",
    );
  });

  it("matches the committed declaration the type-level proof compiles against", async () => {
    const fixtureRoot = path.resolve(__dirname, "../../tests/fixtures/model-resources");
    const models = path.join(fixtureRoot, "src/app/users/models");
    const resources = path.join(fixtureRoot, "src/app/users/resources");
    const generated: ModelResourceEntry[] = [];

    const fixtures: Array<[string, string, string]> = [
      ["fixture-user.model.ts", "../resources/fixture-user.resource", "fixture-user.resource.ts"],
      ["audit-entry.model.ts", "../resources/audit-entry.resource", "audit-entry.resource.ts"],
    ];

    for (const [file, specifier, resourceFile] of fixtures) {
      const absolutePath = path.join(models, file);

      const extraction = extractModelResourceEntries({
        source: await readFile(absolutePath, "utf-8"),
        absolutePath,
        resolveImport: (requested) =>
          requested === specifier ? path.join(resources, resourceFile) : undefined,
      });

      generated.push(...extraction.entries);
    }

    const expected = await readFile(path.join(fixtureRoot, "typings/model-resources.d.ts"), "utf-8");

    expect(renderModelResourceRegistry(generated, path.join(fixtureRoot, "typings"))).toBe(
      expected.replaceAll("\r\n", "\n"),
    );
  });
});

describe("writeFileIfChanged", () => {
  it("writes once and leaves an identical file untouched", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "warlock-write-if-changed-"));
    const file = path.join(directory, "nested", "out.d.ts");

    try {
      expect(await writeFileIfChanged(file, "one")).toBe(true);
      expect(await writeFileIfChanged(file, "one")).toBe(false);
      expect(await writeFileIfChanged(file, "two")).toBe(true);
      expect(await readFile(file, "utf-8")).toBe("two");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
