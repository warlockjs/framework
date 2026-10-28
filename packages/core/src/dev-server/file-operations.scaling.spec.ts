import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesOrchestrator } from "./files-orchestrator";
import * as parseImportsModule from "./parse-imports";

vi.mock("./parse-imports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-imports")>();

  return { ...actual, parseImports: vi.fn(actual.parseImports) };
});

const parseImportsSpy = vi.mocked(parseImportsModule.parseImports);

/**
 * Adding a file used to re-parse every tracked file to find importers that
 * were waiting for it, so booting N files cost N*N/2 parses. The cost is now
 * proportional to the files that actually mention the new file.
 */
describe("FileOperations.addFile scaling", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "warlock-add-file-"));
    mkdirSync(path.join(root, "src/app"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    parseImportsSpy.mockClear();
  });

  afterEach(() => {
    filesOrchestrator.getFiles().clear();
    vi.restoreAllMocks();
  });

  /** A chain `m0 -> m1 -> ... -> m(n-1)`, every module also importing one shared file. */
  function writeChain(count: number): void {
    writeFileSync(path.join(root, "src/app/shared.ts"), "export const shared = 1;\n");

    for (let index = 0; index < count; index++) {
      const next = index + 1 < count ? `import "./m${index + 1}";\n` : "";

      writeFileSync(
        path.join(root, `src/app/m${index}.ts`),
        `import { shared } from "./shared";\n${next}export const value${index} = shared;\n`,
      );
    }
  }

  async function parsesFor(count: number): Promise<number> {
    writeChain(count);
    parseImportsSpy.mockClear();

    await filesOrchestrator.add("src/app/m0.ts");

    expect(filesOrchestrator.getFiles().size).toBe(count + 1);

    return parseImportsSpy.mock.calls.length;
  }

  it("grows linearly with the number of files, not quadratically", async () => {
    const small = await parsesFor(60);

    filesOrchestrator.getFiles().clear();

    const large = await parsesFor(240);

    // 4x the files: linear is about 4x, quadratic about 16x.
    expect(large / small).toBeLessThan(6);
    expect(large).toBeLessThan(240 * 4);
  });

  it("still re-resolves an importer that was waiting for the new file", async () => {
    writeFileSync(path.join(root, "src/app/waiting.ts"), 'import "./late";\n');

    const waiting = await filesOrchestrator.add("src/app/waiting.ts");

    expect(waiting.dependencies.has("src/app/late.ts")).toBe(false);

    writeFileSync(path.join(root, "src/app/late.ts"), "export const late = 1;\n");
    await filesOrchestrator.add("src/app/late.ts");

    expect(waiting.dependencies.has("src/app/late.ts")).toBe(true);
  });

  it("finds an importer waiting for a folder index file", async () => {
    writeFileSync(path.join(root, "src/app/waiting.ts"), 'import "./feature";\n');

    const waiting = await filesOrchestrator.add("src/app/waiting.ts");

    mkdirSync(path.join(root, "src/app/feature"), { recursive: true });
    writeFileSync(path.join(root, "src/app/feature/index.ts"), "export const feature = 1;\n");
    await filesOrchestrator.add("src/app/feature/index.ts");

    expect(waiting.dependencies.has("src/app/feature/index.ts")).toBe(true);
  });
});
