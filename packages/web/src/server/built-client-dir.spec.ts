import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBuiltClientDir } from "./built-client-dir";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-built-client-"));
  mkdirSync(path.join(root, "copy/client/assets"), { recursive: true });
  mkdirSync(path.join(root, "bare"), { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveBuiltClientDir", () => {
  it("uses the client folder next to the bundle when it holds a client build", () => {
    const bundle = pathToFileURL(path.join(root, "copy/app.js")).href;

    expect(resolveBuiltClientDir("dist/client", bundle)).toBe(path.join(root, "copy/client"));
  });

  it("keeps the baked path when no client build sits next to the module", () => {
    const bundle = pathToFileURL(path.join(root, "bare/app.js")).href;

    expect(resolveBuiltClientDir("dist/client", bundle)).toBe("dist/client");
  });

  it("leaves an absolute path alone", () => {
    const bundle = pathToFileURL(path.join(root, "copy/app.js")).href;

    expect(resolveBuiltClientDir("/srv/app/client", bundle)).toBe("/srv/app/client");
  });

  it("keeps the baked path for a module URL that is not a file", () => {
    expect(resolveBuiltClientDir("dist/client", "https://example.test/app.js")).toBe("dist/client");
  });
});
