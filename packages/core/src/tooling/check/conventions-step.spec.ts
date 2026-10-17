import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkFileConventions,
  checkTsconfigConventions,
  isAutoLoadedFile,
  runConventions,
} from "./conventions-step";

let root: string;

function write(relative: string, source = "export {};\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-conventions-"));
  write("src/app/posts/routes.ts");
  write("src/app/posts/main.ts");
  write("src/app/posts/events/audit.event.ts");
  write("src/app/posts/services/publish.service.ts");
  write("src/app/users/services/find-user.service.ts");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function codes(file: string, source: string): string[] {
  return checkFileConventions(file, source, root).map((problem) => problem.code);
}

describe("convention checks", () => {
  it("knows which files the framework loads by itself", () => {
    expect(isAutoLoadedFile("src/app/main.ts")).toBe(true);
    expect(isAutoLoadedFile("src/app/posts/routes.ts")).toBe(true);
    expect(isAutoLoadedFile("src/app/posts/worker.ts")).toBe(true);
    expect(isAutoLoadedFile("src/app/posts/events/audit.event.ts")).toBe(true);
    expect(isAutoLoadedFile("src/app/posts/services/routes-helper.ts")).toBe(false);
    expect(isAutoLoadedFile("src/app/posts/controllers/main-page.controller.ts")).toBe(false);
  });

  it("flags an import of an auto-loaded file (WL9001), but not from a test", () => {
    const file = "src/app/posts/services/publish.service.ts";

    expect(codes(file, 'import "../routes";')).toEqual(["WL9001"]);
    expect(codes(file, 'import { x } from "../events/audit.event";')).toEqual(["WL9001"]);
    expect(codes(file, 'import { y } from "app/posts/main";')).toEqual(["WL9001"]);
    expect(codes("src/app/posts/services/publish.service.spec.ts", 'import "../routes";')).toEqual(
      [],
    );
  });

  it("flags a .js extension on a relative import (WL9002), not on a package", () => {
    const file = "src/app/posts/services/publish.service.ts";

    expect(codes(file, 'import { a } from "./helpers.js";')).toEqual(["WL9002"]);
    expect(codes(file, 'import x from "highlight.js";')).toEqual([]);
  });

  it("flags a relative import into another module (WL9003) with the alias to use", () => {
    const [problem] = checkFileConventions(
      "src/app/posts/services/publish.service.ts",
      'import { findUser } from "../../users/services/find-user.service";',
      root,
    );

    expect(problem).toMatchObject({
      code: "WL9003",
      file: "src/app/posts/services/publish.service.ts",
      line: 1,
      column: 26,
    });
    expect(problem?.message).toContain('"app/users/services/find-user.service"');
    expect(
      codes(
        "src/app/posts/services/publish.service.ts",
        'import { findUser } from "app/users/services/find-user.service";',
      ),
    ).toEqual([]);
    expect(
      codes("src/app/posts/routes.ts", 'import { publish } from "./services/publish.service";'),
    ).toEqual([]);
  });

  it("flags experimentalDecorators in tsconfig (WL9004) and nothing otherwise", () => {
    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{\n  // legacy\n  "compilerOptions": { "experimentalDecorators": true }\n}\n',
    );

    expect(checkTsconfigConventions(root)).toEqual([
      expect.objectContaining({ code: "WL9004", file: "tsconfig.json", line: 3, column: 25 }),
    ]);

    writeFileSync(path.join(root, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }');

    expect(checkTsconfigConventions(root)).toEqual([]);
  });

  it("reads the files it is given from disk", () => {
    write("src/app/posts/controllers/show.controller.ts", 'import "../routes";\n');

    expect(runConventions(root, ["src/app/posts/controllers/show.controller.ts"])).toEqual([
      expect.objectContaining({ code: "WL9001", line: 1, column: 8 }),
    ]);
  });
});
