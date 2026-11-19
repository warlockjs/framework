import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lowerStage3Decorators, stripNonCode } from "./lower-stage3-decorators";

const roots: string[] = [];

async function project(tsconfig: object | undefined, file: string, source: string) {
  const root = await mkdtemp(join(tmpdir(), "warlock-decorators-"));
  roots.push(root);
  if (tsconfig) await writeFile(join(root, "tsconfig.json"), JSON.stringify(tsconfig));
  await mkdir(join(root, "src"), { recursive: true });
  const id = join(root, "src", file);
  await writeFile(id, source);

  return { id, source };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const decoratedTsx = `
function Tag(value: unknown, _context: unknown) { return value; }
@Tag
class Box {}
export const View = () => <div><Box /></div>;
`;

describe("lowerStage3Decorators", () => {
  it("keeps the project's automatic JSX runtime for a decorated .tsx", async () => {
    const { id, source } = await project(
      { compilerOptions: { jsx: "react-jsx" } },
      "a.tsx",
      decoratedTsx,
    );
    const result = await lowerStage3Decorators().transform(source, id);

    expect(result?.code).toContain("react/jsx-runtime");
    expect(result?.code).not.toContain("React.createElement");
  });

  it("uses the project's jsxImportSource, also from an extended tsconfig", async () => {
    const root = await mkdtemp(join(tmpdir(), "warlock-decorators-"));
    roots.push(root);
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(
      join(root, "base.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
    );
    await writeFile(
      join(root, "app", "tsconfig.json"),
      JSON.stringify({ extends: "../base.json" }),
    );
    const id = join(root, "app", "b.tsx");
    const result = await lowerStage3Decorators().transform(decoratedTsx, id);

    expect(result?.code).toContain("preact/jsx-runtime");
  });

  it("defaults to the automatic runtime when the project sets no jsx option", async () => {
    const { id, source } = await project(undefined, "c.tsx", decoratedTsx);
    const result = await lowerStage3Decorators().transform(source, id);

    expect(result?.code).not.toContain("React.createElement");
  });

  it("does not transform a .tsx whose only @ is CSS inside a template string", async () => {
    const source = [
      "const css = `",
      "@media (max-width: 600px) {",
      "  .a { color: red; }",
      "}",
      "@font-face { font-family: x; }",
      "`;",
      "export const View = () => <style>{css}</style>;",
    ].join("\n");
    const { id } = await project({ compilerOptions: { jsx: "react-jsx" } }, "d.tsx", source);

    expect(await lowerStage3Decorators().transform(source, id)).toBeNull();
  });

  it("does not transform an @ that only appears in a comment", async () => {
    const source = "/**\n * @param value the value\n */\n// @deprecated\nexport const x = 1;\n";
    const { id } = await project(undefined, "e.ts", source);

    expect(await lowerStage3Decorators().transform(source, id)).toBeNull();
  });

  it("still lowers a decorator that sits next to a template string", async () => {
    const source =
      "const css = `@media {}`;\n@Tag\nclass A {}\nfunction Tag(v: unknown) { return v; }\n";
    const { id } = await project(undefined, "f.ts", source);

    expect(await lowerStage3Decorators().transform(source, id)).not.toBeNull();
  });
});

describe("stripNonCode", () => {
  it("keeps code inside template expressions", () => {
    expect(stripNonCode("`a ${\n@x\n} b`")).toContain("@x");
  });

  it("keeps the line break after an unclosed quote, so a decorator on the next line is seen", () => {
    expect(stripNonCode("const label = <p>Don't</p>;\n@Injectable()\nclass A {}")).toMatch(
      /\n@Injectable/,
    );
    expect(stripNonCode("const quotes = /[\"']/;\n@Injectable()\nclass A {}")).toMatch(
      /\n@Injectable/,
    );
  });

  it("returns the source unchanged when a template never closes", () => {
    const source = "const a = `oops\n@Tag\nclass A {}";

    expect(stripNonCode(source)).toBe(source);
  });
});
