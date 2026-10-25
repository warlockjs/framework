import { describe, expect, it } from "vitest";
import type { InspectReport } from "../../../tooling/inspect/inspect-report.types";
import { INSPECT_SECTIONS } from "../../../tooling/inspect/inspect-report.types";
import { inspectCommand } from "../inspect.command";
import { formatInspectSummary } from "./inspect-command.action";

function report(wiring: InspectReport["wiring"]): InspectReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    app: {
      name: "shop",
      version: "1.0.0",
      root: "/shop",
      node: "v22.15.0",
      environment: "development",
      runtimeStrategy: "development",
    },
    sections: ["wiring"],
    wiring,
    components: { schemas: {} },
    warnings: [],
  };
}

describe("warlock inspect --section wiring", () => {
  it("prints the load order and the capability slots", () => {
    const lines = formatInspectSummary(
      report([
        {
          type: "file",
          role: "config",
          file: "src/config/http.ts",
          module: "src/config",
          order: 1,
        },
        {
          type: "file",
          role: "main",
          file: "src/app/posts/main.ts",
          module: "src/app/posts",
          order: 2,
        },
        {
          type: "capability",
          name: "posts.notifier",
          description: null,
          required: true,
          provided: true,
          definedIn: "src/app/posts/capabilities.ts",
          providedBy: "src/app/posts/main.ts",
          consumers: [],
        },
        {
          type: "capability",
          name: "posts.audit",
          description: null,
          required: true,
          provided: false,
          definedIn: null,
          providedBy: null,
          consumers: [],
        },
        {
          type: "capability",
          name: "posts.cache",
          description: null,
          required: false,
          provided: false,
          definedIn: null,
          providedBy: null,
          consumers: [],
        },
      ]),
    );
    const text = lines.join("\n");

    expect(text).toContain("wiring       5");
    expect(text).toContain("Wiring (boot load order):");
    expect(text).toMatch(/1\s+config\s+src\/config\/http\.ts/);
    expect(text).toMatch(/2\s+main\s+src\/app\/posts\/main\.ts/);
    expect(text).toContain("posts.notifier  provided by src/app/posts/main.ts");
    expect(text).toContain("posts.audit  NOT PROVIDED");
    expect(text).toContain("posts.cache  not provided (optional)");
  });

  it("is a valid --section value, documented in the option help", () => {
    expect(INSPECT_SECTIONS).toContain("wiring");
    expect(
      inspectCommand.commandOptions.some((option) => option.description?.includes("wiring")),
    ).toBe(true);
  });
});
