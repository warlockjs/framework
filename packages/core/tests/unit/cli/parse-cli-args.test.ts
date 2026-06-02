import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../../src/cli/parse-cli-args";

/**
 * Unit coverage for `parseCliArgs`, the raw `process.argv` → `{ name, args,
 * options }` splitter. argv always starts `[node, script, ...]`, so the
 * command lives at index 2 unless it begins with `-` (then there is no
 * command and parsing starts at index 2).
 */
const argv = (...rest: string[]) => ["node", "warlock", ...rest];

describe("parseCliArgs — command name", () => {
  it("reads the command from index 2", () => {
    expect(parseCliArgs(argv("migrate")).name).toBe("migrate");
  });

  it("returns an empty command when the first token is an option", () => {
    const parsed = parseCliArgs(argv("--help"));

    expect(parsed.name).toBe("");
    expect(parsed.options.help).toBe(true);
  });

  it("returns an empty command for bare argv", () => {
    expect(parseCliArgs(["node", "warlock"]).name).toBe("");
  });
});

describe("parseCliArgs — long options", () => {
  it("parses --key=value", () => {
    expect(parseCliArgs(argv("dev", "--port=3000")).options).toEqual({ port: "3000" });
  });

  it("treats a bare --flag as boolean true", () => {
    expect(parseCliArgs(argv("dev", "--fresh")).options).toEqual({ fresh: true });
  });

  it("consumes the next token as a value when it is not an option", () => {
    expect(parseCliArgs(argv("migrate", "--path", "users.ts")).options).toEqual({
      path: "users.ts",
    });
  });

  it("does not consume the next token when it is another option", () => {
    const parsed = parseCliArgs(argv("dev", "--fresh", "--port=3000"));

    expect(parsed.options.fresh).toBe(true);
    expect(parsed.options.port).toBe("3000");
  });

  it("camelCases kebab-case option keys", () => {
    expect(parseCliArgs(argv("build", "--no-cache")).options).toEqual({ noCache: true });
    expect(parseCliArgs(argv("gen", "--with-validation")).options).toEqual({
      withValidation: true,
    });
  });
});

describe("parseCliArgs — short options", () => {
  it("parses a single short flag as boolean", () => {
    expect(parseCliArgs(argv("migrate", "-f")).options).toEqual({ f: true });
  });

  it("parses -k=value form", () => {
    expect(parseCliArgs(argv("dev", "-p=3000")).options).toEqual({ p: "3000" });
  });

  it("consumes the next token as a value for a single short flag", () => {
    expect(parseCliArgs(argv("migrate", "-p", "file.ts")).options).toEqual({ p: "file.ts" });
  });

  it("expands grouped short flags into individual booleans", () => {
    expect(parseCliArgs(argv("cmd", "-abc")).options).toEqual({ a: true, b: true, c: true });
  });
});

describe("parseCliArgs — positional arguments", () => {
  it("collects non-option tokens in order", () => {
    expect(parseCliArgs(argv("migrate", "users", "posts")).args).toEqual(["users", "posts"]);
  });

  it("separates positionals from options regardless of order", () => {
    const parsed = parseCliArgs(argv("generate", "module", "products", "--force"));

    expect(parsed.name).toBe("generate");
    expect(parsed.args).toEqual(["module", "products"]);
    expect(parsed.options).toEqual({ force: true });
  });

  it("keeps a value token attached to its flag out of the positional list", () => {
    const parsed = parseCliArgs(argv("migrate", "--path", "file.ts", "users"));

    expect(parsed.options.path).toBe("file.ts");
    expect(parsed.args).toEqual(["users"]);
  });
});

describe("parseCliArgs — full command lines from the docblock", () => {
  it("matches the migrate rollback example", () => {
    const parsed = parseCliArgs(["node", "warlock", "migrate", "--rollback", "file.ts"]);

    expect(parsed.name).toBe("migrate");
    expect(parsed.args).toEqual([]);
    expect(parsed.options).toEqual({ rollback: "file.ts" });
  });

  it("matches the dev example", () => {
    const parsed = parseCliArgs(["node", "warlock", "dev", "--port=3000", "--fresh"]);

    expect(parsed.name).toBe("dev");
    expect(parsed.args).toEqual([]);
    expect(parsed.options).toEqual({ port: "3000", fresh: true });
  });
});
