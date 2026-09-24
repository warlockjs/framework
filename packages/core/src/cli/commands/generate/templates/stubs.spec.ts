import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluralName } from "../utils/name-parser";
import { crudRepositoryStub, crudSeedStub, repositoryStub, resourceStub } from "./stubs";

/**
 * Every `@warlock.js/core` type a generated file NAMES must also be IMPORTED,
 * or the file it emits does not typecheck and `npm run build` goes red on code
 * the developer never wrote. `crudRepositoryStub` (what `generate.module`
 * emits) referenced `RepositoryOptions` in `defaultOptions: RepositoryOptions`
 * while importing only `TypedRepositoryOptions` — finding c2785f56. This gate
 * asserts the type-import covers what the body uses.
 */
describe("crudRepositoryStub — generated repository is self-consistent (c2785f56)", () => {
  const source = crudRepositoryStub(pluralName("post"));

  /** The names in `import type { ... } from "@warlock.js/core"`. */
  const typeImport = source.match(/import type \{([^}]*)\} from "@warlock\.js\/core"/);
  const importedTypes = (typeImport?.[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  it("imports every @warlock.js/core type it references", () => {
    // RepositoryOptions is used in `public defaultOptions: RepositoryOptions`.
    for (const referenced of ["FilterRules", "RepositoryOptions", "TypedRepositoryOptions"]) {
      if (source.includes(referenced)) {
        expect(importedTypes).toContain(referenced);
      }
    }
  });

  it("specifically imports RepositoryOptions, since defaultOptions is typed with it", () => {
    expect(source).toMatch(/defaultOptions:\s*RepositoryOptions/);
    expect(importedTypes).toContain("RepositoryOptions");
  });
});

/**
 * A generated seed stub calls `create({})` with placeholder data, which fails
 * required-field validation and aborts the WHOLE `warlock seed` run (finding
 * c1fece2e). So the stub must be disabled until the developer fills it in.
 */
/**
 * Owner ruling (Hasan 2026-09-12): remove `.required()` from emitted templates
 * — seal is required-by-default, so the call is a redundant no-op that teaches
 * "omitting it = optional", which is false. The method stays in seal (docs
 * mention it); generated/starter code must not use it.
 */
describe("emitted templates carry no redundant .required() (Hasan ruling)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = {
    "generate templates": path.join(here, "stubs.ts"),
    "starter/generation stubs": path.join(here, "../../../../generations/stubs.ts"),
  };

  for (const [label, file] of Object.entries(files)) {
    it(`${label} emit no .required()`, () => {
      expect(readFileSync(file, "utf-8")).not.toContain(".required()");
    });
  }
});

describe("crudSeedStub — a fresh seed stub is inert (c1fece2e)", () => {
  const source = crudSeedStub(pluralName("post"));

  it("is generated disabled so an unfilled stub cannot abort `warlock seed`", () => {
    // Strip line comments first: the guiding comment legitimately mentions
    // "set enabled: true", and only the actual OPTION value is under test.
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/enabled:\s*false/);
    expect(code).not.toMatch(/enabled:\s*true/);
  });
});

/**
 * C4 B2/B3: generate.resource emitted an instance `schema` (serialized to `{}`),
 * generate.repository imported a non-existent `FilterByOptions` and called
 * non-existent `withDefaultOptions()` / `withDefaultFilters()`.
 */
describe("repositoryStub / resourceStub use real exports", () => {
  const repo = repositoryStub(pluralName("post"));
  const resource = resourceStub(pluralName("post"));

  it("repositoryStub does not reference removed APIs", () => {
    expect(repo).not.toContain("FilterByOptions");
    expect(repo).not.toContain("withDefaultOptions");
    expect(repo).not.toContain("withDefaultFilters");
  });

  it("repositoryStub imports only names core exports", () => {
    const names = (repo.match(/import type \{([^}]*)\} from "@warlock\.js\/core"/)?.[1] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    expect(names).toEqual(["FilterRules", "RepositoryOptions", "TypedRepositoryOptions"]);
  });

  it("resourceStub declares a static schema", () => {
    expect(resource).toContain("public static schema");
    expect(resource).not.toMatch(/^\s*public schema/m);
  });
});
