import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFileConventions } from "./conventions-step";
import { serverBundleImportHazard } from "./server-graph-imports";

let root: string;

function write(relative: string, source = "export const value = 1;\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function problems(file: string, source: string) {
  return checkFileConventions(file, source, root).filter((problem) => problem.code === "WL9027");
}

const WORKER = 'import workerUrl from "some-pkg/dist/worker.mjs?worker&url";\nexport { workerUrl };\n';

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-server-graph-"));
  write("src/web/main/home.page.tsx", 'import "../../app/shared/chart";\nexport default () => null;\n');
  write("src/app/shared/chart.ts", 'export const chart = 1;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("serverBundleImportHazard", () => {
  it("flags assets and ?raw, ?url and ?worker queries", () => {
    expect(serverBundleImportHazard("./logo.svg")).toBeDefined();
    expect(serverBundleImportHazard("./a.txt?raw")).toBeDefined();
    expect(serverBundleImportHazard("./a.js?url")).toBeDefined();
    expect(serverBundleImportHazard("pkg/w.mjs?worker&url")).toBeDefined();
    expect(serverBundleImportHazard("./a")).toBeUndefined();
    expect(serverBundleImportHazard("./a?inline-thing")).toBeUndefined();
  });
});

describe("WL9027 server bundle imports", () => {
  it("flags a page-graph file under src/web, naming the file, the import and the fix", () => {
    write("src/web/main/chart.client.tsx", WORKER);

    const found = problems("src/web/main/chart.client.tsx", WORKER);

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("src/web/main/chart.client.tsx");
    expect(found[0]?.message).toContain("some-pkg/dist/worker.mjs?worker&url");
    expect(found[0]?.message).toContain("public/ directory");
  });

  it("words a bare ?worker query as something that may fail", () => {
    const source = 'import Worker from "./job.ts?worker";\nexport { Worker };\n';

    write("src/web/main/job.client.ts", source);

    const [found] = problems("src/web/main/job.client.ts", source);

    expect(found?.severity).toBe("warning");
    expect(found?.message).toContain("may fail");
  });

  it("flags a file outside src/web that a src/web file imports", () => {
    expect(problems("src/app/shared/chart.ts", WORKER)).toHaveLength(1);
  });

  it("ignores a file no page-graph file reaches", () => {
    write("src/app/shared/only-browser.ts", WORKER);

    expect(problems("src/app/shared/only-browser.ts", WORKER)).toEqual([]);
  });

  it("ignores test files and type-only imports", () => {
    expect(problems("src/web/main/chart.spec.tsx", WORKER)).toEqual([]);
    expect(
      problems("src/web/main/types.ts", 'import type u from "pkg/w.mjs?worker&url";\n'),
    ).toEqual([]);
  });

  it("can be silenced with a warlock-check-ignore comment", () => {
    expect(
      problems("src/web/main/chart.client.tsx", `// warlock-check-ignore WL9027\n${WORKER}`),
    ).toEqual([]);
  });
});
