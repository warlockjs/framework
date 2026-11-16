import { describe, expect, it } from "vitest";
import {
  appendGitignoreLines,
  ensureImportLine,
  GRIMOIRE_GITIGNORE_LINES,
  insertDevtoolsPanel,
  insertVitestReporter,
} from "./insert-grimoire-wiring";

describe("ensureImportLine", () => {
  const line = 'import { grimoireReporter } from "@warlock.js/grimoire/vitest";';

  it("adds the import once", () => {
    const once = ensureImportLine("export default {};\n", line);

    expect(once).toBe(`${line}\nexport default {};\n`);
    expect(ensureImportLine(once, line)).toBe(once);
  });

  it("keeps CRLF line endings", () => {
    expect(ensureImportLine("export default {};\r\n", line)).toBe(
      `${line}\r\nexport default {};\r\n`,
    );
  });
});

describe("appendGitignoreLines", () => {
  it("adds only the missing lines and is idempotent", () => {
    const next = appendGitignoreLines("node_modules\n/grimoire/book/\n", GRIMOIRE_GITIGNORE_LINES);

    expect(next).toContain("/grimoire/tasks/index.json");
    expect(next?.match(/\/grimoire\/book\//g)).toHaveLength(1);
    expect(appendGitignoreLines(next ?? "", GRIMOIRE_GITIGNORE_LINES)).toBeNull();
  });

  it("starts a new file", () => {
    expect(appendGitignoreLines("", GRIMOIRE_GITIGNORE_LINES)).toContain("/grimoire/book/\n");
  });
});

describe("insertVitestReporter", () => {
  const call = "grimoireReporter()";

  it("appends to a single-line reporters list", () => {
    const result = insertVitestReporter('test: { reporters: ["default", new A()], x: 1 }', call);

    expect(result).toEqual({
      status: "added",
      next: 'test: { reporters: ["default", new A(), grimoireReporter()], x: 1 }',
    });
  });

  it("appends to a multi-line list", () => {
    const result = insertVitestReporter(
      ["test: {", "  reporters: [", '    "default",', "    new A(),", "  ],", "}"].join("\n"),
      call,
    );

    expect(result.status === "added" && result.next).toBe(
      [
        "test: {",
        "  reporters: [",
        '    "default",',
        "    new A(),",
        "    grimoireReporter(),",
        "  ],",
        "}",
      ].join("\n"),
    );
  });

  it("adds a reporters list to a test block without one", () => {
    const result = insertVitestReporter(
      "export default defineConfig({\n  test: {\n    maxWorkers: 2,\n  },\n});\n",
      call,
    );

    expect(result.status === "added" && result.next).toContain(
      '  test: {\n    reporters: ["default", grimoireReporter()],\n    maxWorkers: 2,',
    );
  });

  it("appends after a reporter given with options, not inside it", () => {
    const single = insertVitestReporter(
      'test: { reporters: [["json", { outputFile: "r.json" }], "default"] }',
      call,
    );

    expect(single.status === "added" && single.next).toBe(
      'test: { reporters: [["json", { outputFile: "r.json" }], "default", grimoireReporter()] }',
    );

    const multi = insertVitestReporter(
      [
        "test: {",
        "  reporters: [",
        '    "default",',
        '    ["junit", { outputFile: "j.xml" }],',
        "  ],",
        "}",
      ].join("\n"),
      call,
    );

    expect(multi.status === "added" && multi.next).toContain(
      '    ["junit", { outputFile: "j.xml" }],\n    grimoireReporter(),\n  ],',
    );
  });

  it("leaves reporters set without a list alone", () => {
    expect(insertVitestReporter('test: { reporters: "verbose" }', call)).toEqual({
      status: "unrecognised",
    });
  });

  it("is idempotent and reports an unknown file", () => {
    expect(insertVitestReporter("reporters: [grimoireReporter()]", call)).toEqual({
      status: "already-present",
    });
    expect(insertVitestReporter("export default {};", call)).toEqual({ status: "unrecognised" });
  });
});

describe("insertDevtoolsPanel", () => {
  const panel = "@warlock.js/grimoire/devtools";

  it("adds to an existing panels list", () => {
    const result = insertDevtoolsPanel('export default { panels: ["./x"] };', panel);

    expect(result.status === "added" && result.next).toBe(
      'export default { panels: ["@warlock.js/grimoire/devtools", "./x"] };',
    );
  });

  it("adds a panels property to the exported object", () => {
    const result = insertDevtoolsPanel("export default {\n  maxRequests: 50,\n};\n", panel);

    expect(result.status === "added" && result.next).toBe(
      'export default {\n  panels: ["@warlock.js/grimoire/devtools"],\n  maxRequests: 50,\n};\n',
    );
  });

  it("adds to a typed settings object and leaves panels from a variable alone", () => {
    const typed = insertDevtoolsPanel(
      "const settings: DevtoolsOptions = {\n  maxRequests: 50,\n};\nexport default settings;\n",
      panel,
    );

    expect(typed.status === "added" && typed.next).toContain(
      '= {\n  panels: ["@warlock.js/grimoire/devtools"],\n  maxRequests: 50,',
    );
    expect(insertDevtoolsPanel("export default { panels: myPanels };", panel)).toEqual({
      status: "unrecognised",
    });
  });

  it("is idempotent", () => {
    expect(insertDevtoolsPanel(`export default { panels: ["${panel}"] };`, panel)).toEqual({
      status: "already-present",
    });
  });
});
