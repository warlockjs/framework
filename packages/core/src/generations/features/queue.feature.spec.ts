import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configText = "";

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => true),
  getFileAsync: vi.fn(async () => configText),
  putFileAsync: vi.fn(async (_path: string, content: string) => {
    configText = content;
  }),
}));

import { queueFeature } from "./queue.feature";

describe("add queue — registers queueConnector() in warlock.config.ts", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("inserts a space after the comma next to an existing connector", async () => {
    configText =
      'import { webConnector } from "@warlock.js/web/connector";\n\n' +
      "export default defineConfig({ connectors: [webConnector()] });\n";

    await queueFeature.onExecuting?.({} as never);

    expect(configText).toContain("connectors: [queueConnector(), webConnector()]");
  });

  it("fills an empty connectors array with the bare call", async () => {
    configText = "export default defineConfig({ connectors: [] });\n";

    await queueFeature.onExecuting?.({} as never);

    expect(configText).toContain("connectors: [queueConnector()]");
  });

  it("adds the entry on its own line in a multi-line array", async () => {
    configText = [
      "export default defineConfig({",
      "  connectors: [",
      "    webConnector(),",
      "  ],",
      "});",
      "",
    ].join("\n");

    await queueFeature.onExecuting?.({} as never);

    expect(configText).toContain("    queueConnector(),\n    webConnector(),");
  });

  it("is idempotent when queueConnector is already registered", async () => {
    const original =
      "export default defineConfig({ connectors: [queueConnector(), webConnector()] });\n";
    configText = original;

    await queueFeature.onExecuting?.({} as never);

    expect(configText).toBe(original);
  });
});
