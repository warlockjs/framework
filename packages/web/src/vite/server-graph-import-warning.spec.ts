import { describe, expect, it } from "vitest";
import { serverGraphImportHazards } from "../build/server-graph-imports";
import {
  serverGraphImportWarning,
  serverGraphImportWarningPlugin,
} from "./server-graph-import-warning";

const APP = "/app";
const FILE = "/app/src/web/chart.tsx";

type Transform = (
  this: { warn(message: string): void },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => unknown;

function transformWith(plugin = serverGraphImportWarningPlugin(APP)) {
  const warnings: string[] = [];
  const transform = plugin.transform as Transform;
  const run = (code: string, id: string, ssr: boolean) =>
    transform.call({ warn: (message) => warnings.push(message) }, code, id, { ssr });

  return { warnings, run };
}

describe("serverGraphImportHazards", () => {
  it("flags ?url, ?raw and ?worker queries and static assets", () => {
    const code = [
      `import workerUrl from "some-pkg/dist/worker.mjs?worker&url";`,
      `import text from "./notes.txt?raw";`,
      `import file from "./file.js?url";`,
      `import Worker from "./job.ts?worker";`,
      `import logo from "./logo.svg";`,
    ].join("\n");

    expect(serverGraphImportHazards(code).map((hazard) => hazard.specifier)).toEqual([
      "some-pkg/dist/worker.mjs?worker&url",
      "./notes.txt?raw",
      "./file.js?url",
      "./job.ts?worker",
      "./logo.svg",
    ]);
  });

  it("ignores plain imports, other queries and specifiers inside comments", () => {
    const code = [
      `import { a } from "./a";`,
      `import b from "./b?inline-thing";`,
      `// import x from "./x?url";`,
    ].join("\n");

    expect(serverGraphImportHazards(code)).toEqual([]);
  });
});

describe("serverGraphImportWarning", () => {
  it("names the file, the import and the build's advice", () => {
    const message = serverGraphImportWarning(
      `import u from "pkg/worker.mjs?worker&url";`,
      "src/web/chart.tsx",
    );

    expect(message).toContain("src/web/chart.tsx");
    expect(message).toContain("pkg/worker.mjs?worker&url");
    expect(message).toContain("public/");
  });

  it("words a bare ?worker query as something that may fail", () => {
    const message = serverGraphImportWarning(`import W from "./job.ts?worker";`, "src/web/job.ts");

    expect(message).toContain("may fail");
    expect(message).not.toContain("and `warlock build` fails on it");
  });

  it("is undefined for a clean module", () => {
    expect(serverGraphImportWarning(`import a from "./a";`, "x.ts")).toBeUndefined();
  });
});

describe("serverGraphImportWarningPlugin", () => {
  const code = `import u from "pkg/worker.mjs?worker&url";\n`;

  it("warns for a module evaluated on the server, once per file", () => {
    const { warnings, run } = transformWith();

    run(code, FILE, true);
    run(code, FILE, true);

    expect(warnings).toHaveLength(1);
  });

  it("ignores the browser environment, tests and dependencies", () => {
    const { warnings, run } = transformWith();

    run(code, FILE, false);
    run(code, "/app/src/web/chart.spec.tsx", true);
    run(code, "/app/node_modules/pkg/index.js", true);

    expect(warnings).toEqual([]);
  });
});
