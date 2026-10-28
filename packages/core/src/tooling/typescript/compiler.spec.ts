import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CompilerSession, parseCompilerOutput } from "./compiler";

describe("native compiler adapter", () => {
  it("parses file, global and chained CLI diagnostics without losing Windows paths", () => {
    const diagnostics = parseCompilerOutput(
      "C:/app/file.ts(2,4): error TS2322: Wrong type.\n  Details.\nerror TS18003: No inputs.\n",
      process.cwd(),
    );
    expect(
      diagnostics.map(({ code, line, column, message }) => ({ code, line, column, message })),
    ).toEqual([
      { code: 2322, line: 2, column: 4, message: "Wrong type.\n  Details." },
      { code: 18003, line: 1, column: 1, message: "No inputs." },
    ]);
    expect(path.normalize(diagnostics[0]?.fileName ?? "")).toContain(
      path.normalize("C:/app/file.ts"),
    );
  });
  it("updates one session from unsaved source and preserves diagnostic columns after Unicode", () => {
    const root = mkdtempSync(path.join(tmpdir(), "warlock-native-compiler-"));
    const file = path.join(root, "source.ts");
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noLib: true, noEmit: true, types: [] },
        files: ["source.ts"],
      }),
    );
    const source = 'const emoji = "😀"; const value: number = "bad";';
    writeFileSync(file, source);
    const session = new CompilerSession(root);
    try {
      expect(session.diagnostics(file)).toEqual([
        expect.objectContaining({ code: 2322, line: 1, column: source.indexOf("value") + 1 }),
      ]);
      session.update([{ path: file, content: source.replace('"bad"', "1") }]);
      expect(session.diagnostics(file)).toEqual([]);
    } finally {
      session.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
