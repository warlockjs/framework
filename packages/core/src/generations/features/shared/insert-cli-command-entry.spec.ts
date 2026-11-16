import { describe, expect, it } from "vitest";
import { insertCliCommandEntry } from "./insert-cli-command-entry";

const CALL = "registerGrimoireCommands()";

function added(source: string): string {
  const result = insertCliCommandEntry(source, CALL);

  expect(result.status).toBe("added");

  return result.status === "added" ? result.next : "";
}

describe("insertCliCommandEntry", () => {
  it("adds the entry to a single-line commands array", () => {
    const next = added("export default defineConfig({ cli: { commands: [a()] } });\n");

    expect(next).toContain("commands: [registerGrimoireCommands(), a()]");
  });

  it("fills an empty commands array", () => {
    expect(added("defineConfig({ cli: { commands: [] } })")).toContain(
      "commands: [registerGrimoireCommands()]",
    );
  });

  it("adds a line to a multi-line commands array and keeps the indentation", () => {
    const next = added(
      ["defineConfig({", "  cli: {", "    commands: [", "      a(),", "    ],", "  },", "});", ""].join(
        "\n",
      ),
    );

    expect(next).toContain("      registerGrimoireCommands(),\n      a(),");
  });

  it("adds commands to a cli block that has none", () => {
    const next = added(["defineConfig({", "  cli: {", "    quiet: true,", "  },", "});"].join("\n"));

    expect(next).toContain("  cli: {\n    commands: [registerGrimoireCommands()],\n    quiet: true,");
  });

  it("fills an empty cli block", () => {
    expect(added("defineConfig({ cli: {} })")).toContain(
      "cli: { commands: [registerGrimoireCommands()] }",
    );
  });

  it("creates the cli block when there is none, keeping the other properties", () => {
    const source = ["export default defineConfig({", "  database: {},", "});", ""].join("\n");
    const next = added(source);

    expect(next).toBe(
      [
        "export default defineConfig({",
        "  cli: { commands: [registerGrimoireCommands()] },",
        "  database: {},",
        "});",
        "",
      ].join("\n"),
    );
  });

  it("creates the cli block in a single-line config and in an empty one", () => {
    expect(added("defineConfig({ a: 1 })")).toBe(
      "defineConfig({ cli: { commands: [registerGrimoireCommands()] }, a: 1 })",
    );
    expect(added("defineConfig({})")).toBe(
      "defineConfig({ cli: { commands: [registerGrimoireCommands()] } })",
    );
  });

  it("keeps CRLF line endings", () => {
    const next = added("defineConfig({\r\n  a: 1,\r\n});\r\n");

    expect(next).toBe(
      "defineConfig({\r\n  cli: { commands: [registerGrimoireCommands()] },\r\n  a: 1,\r\n});\r\n",
    );
  });

  it("does not take a commands array of another block", () => {
    const next = added("defineConfig({ cli: {}, other: { commands: [x()] } })");

    expect(next).toContain("cli: { commands: [registerGrimoireCommands()] }");
    expect(next).toContain("other: { commands: [x()] }");
  });

  it("is idempotent", () => {
    const first = added("defineConfig({ a: 1 })");

    expect(insertCliCommandEntry(first, CALL)).toEqual({ status: "already-present" });
  });

  it("reports a file with no defineConfig object", () => {
    expect(insertCliCommandEntry("export default {};\n", CALL)).toEqual({ status: "unrecognised" });
  });
});
