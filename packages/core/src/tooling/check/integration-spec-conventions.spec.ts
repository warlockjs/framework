import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFileConventions, resolveSpecifier } from "./conventions-step";
import { integrationSpecProblems } from "./integration-spec-conventions";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-integration-spec-"));

  directories.push(root);

  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }

  return root;
}

function problems(root: string, file: string, source: string) {
  return integrationSpecProblems(file, source, root, (specifier, importer) =>
    resolveSpecifier(specifier, importer, root),
  );
}

describe("WL9021", () => {
  it("warns about an integration spec that imports nothing needing the app", () => {
    const source = `import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n`;
    const root = project({ "src/app/math/add.test.ts": source });

    const [problem] = problems(root, "src/app/math/add.test.ts", source);

    expect(problem).toMatchObject({
      code: "WL9021",
      severity: "warning",
      file: "src/app/math/add.test.ts",
      line: 1,
    });
    expect(problem?.message).toContain("*.spec.ts");
  });

  it("also covers specs under tests/", () => {
    const source = `import { it } from "vitest";\nit("x", () => undefined);\n`;
    const root = project({ "tests/plain.spec.ts": source });

    expect(problems(root, "tests/plain.spec.ts", source)).toHaveLength(1);
  });

  it.each([
    'import { createTestHttpServer } from "@warlock.js/core/tests";',
    'import { User } from "app/users/models/user";',
    'import { Model } from "@warlock.js/cascade";',
  ])("accepts a spec that imports the app: %s", (line) => {
    const source = `${line}\nimport { it } from "vitest";\n`;
    const root = project({ "src/a.test.ts": source });

    expect(problems(root, "src/a.test.ts", source)).toEqual([]);
  });

  it("follows relative imports to a helper that touches the app", () => {
    const test = `import { buildUser } from "./helpers";\nimport { it } from "vitest";\n`;
    const root = project({
      "src/a.test.ts": test,
      "src/helpers.ts": 'import { User } from "app/users/models/user";\nexport const buildUser = () => User;\n',
    });

    expect(problems(root, "src/a.test.ts", test)).toEqual([]);
  });

  it("does not look at unit specs", () => {
    const source = `import { it } from "vitest";\n`;
    const root = project({ "src/a.spec.ts": source });

    expect(problems(root, "src/a.spec.ts", source)).toEqual([]);
  });

  it("can be silenced with warlock-check-ignore and configured through rules", () => {
    const ignored = `// warlock-check-ignore WL9021\nimport { it } from "vitest";\n`;
    const root = project({ "src/a.test.ts": ignored });

    expect(checkFileConventions("src/a.test.ts", ignored, root)).toEqual([]);

    const plain = `import { it } from "vitest";\n`;
    const off = checkFileConventions("src/a.test.ts", plain, root, { rules: { WL9021: "off" } });

    expect(off).toEqual([]);
  });
});
