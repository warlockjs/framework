import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tsconfigPathAliases } from "./tsconfig-path-aliases";

const roots: string[] = [];

function appWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-aliases-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("tsconfigPathAliases", () => {
  it("mirrors wildcard and exact paths, anchored on baseUrl", () => {
    const root = appWith({
      "tsconfig.json": `{
        // comment
        "compilerOptions": {
          "baseUrl": "./src",
          "paths": { "@shared/*": ["shared/*"], "@env": ["config/env.ts"], },
        },
      }`,
    });

    const aliases = tsconfigPathAliases(root);

    expect(aliases).toHaveLength(2);
    expect(aliases[0]?.find.test("@shared/format")).toBe(true);
    expect(aliases[0]?.find.test("@sharedx/format")).toBe(false);
    expect(aliases[0]?.replacement).toBe(`${path.join(root, "src", "shared")}/`);
    expect(aliases[1]?.find.test("@env")).toBe(true);
    expect(aliases[1]?.find.test("@env/x")).toBe(false);
    expect(aliases[1]?.replacement).toBe(path.join(root, "src", "config", "env.ts"));
  });

  it("follows a relative extends and returns nothing without paths or a tsconfig", () => {
    const root = appWith({
      "tsconfig.base.json": `{ "compilerOptions": { "paths": { "@lib/*": ["./lib/*"] } } }`,
      "tsconfig.json": `{ "extends": "./tsconfig.base" }`,
    });

    expect(tsconfigPathAliases(root)[0]?.replacement).toBe(`${path.join(root, "lib")}/`);
    expect(tsconfigPathAliases(appWith({ "tsconfig.json": "{}" }))).toEqual([]);
    expect(tsconfigPathAliases(appWith({}))).toEqual([]);
  });
});
