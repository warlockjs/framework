import { describe, expect, it } from "vitest";
import { buildGeneratorArgs, type GeneratorSpec } from "./generator-spec";

describe("buildGeneratorArgs", () => {
  it("builds a generate.* argv with boolean and string flags", () => {
    expect(
      buildGeneratorArgs({
        type: "make",
        generator: "model",
        name: "posts/post",
        flags: { "with-resource": true, table: "posts", timestamps: false },
      }),
    ).toEqual([
      "generate.model",
      "posts/post",
      "--with-resource",
      "--table=posts",
      "--timestamps=false",
    ]);
  });

  it("adds --no-install to add unless install is requested", () => {
    expect(buildGeneratorArgs({ type: "add", features: ["devtools", "mail"] })).toEqual([
      "add",
      "devtools",
      "mail",
      "--no-install",
    ]);
    expect(buildGeneratorArgs({ type: "add", features: ["devtools"] }, { install: true })).toEqual([
      "add",
      "devtools",
    ]);
  });

  it("rejects flags the generator does not declare, including --dry-run", () => {
    expect(() =>
      buildGeneratorArgs({
        type: "make",
        generator: "service",
        name: "users/x",
        flags: { "dry-run": true },
      }),
    ).toThrow(/Unknown flag --dry-run for generate.service/);
    expect(() =>
      buildGeneratorArgs({
        type: "make",
        generator: "service",
        name: "users/x",
        flags: { Force: true },
      }),
    ).toThrow(/Unknown flag/);
  });

  it("rejects values that could be read as another flag", () => {
    expect(() =>
      buildGeneratorArgs({
        type: "make",
        generator: "model",
        name: "a/b",
        flags: { table: "--force" },
      }),
    ).toThrow(/may not be empty, start with "-"/);
    expect(() =>
      buildGeneratorArgs({
        type: "make",
        generator: "model",
        name: "a/b",
        flags: { table: "a\nb" },
      }),
    ).toThrow(/line break/);
  });

  it("rejects unknown generators, unsafe names and bad feature names", () => {
    const unknown: GeneratorSpec = { type: "make", generator: "module", name: "x" };

    // A request from an MCP client is not typed: the generator is checked at runtime.
    Object.assign(unknown, { generator: "page" });
    expect(() => buildGeneratorArgs(unknown)).toThrow(/Unknown generator "page"/);

    for (const name of ["../etc", "-rf", "/abs", "a//b", "a/../b", ""]) {
      expect(() => buildGeneratorArgs({ type: "make", generator: "module", name }), name).toThrow(
        /Invalid name/,
      );
    }

    expect(() => buildGeneratorArgs({ type: "add", features: [] })).toThrow(/at least one feature/);
    expect(() => buildGeneratorArgs({ type: "add", features: ["--list"] })).toThrow(
      /Invalid feature/,
    );
  });
});
