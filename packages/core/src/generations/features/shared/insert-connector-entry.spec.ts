import { describe, expect, it } from "vitest";
import { insertConnectorEntry } from "./insert-connector-entry";

describe("insertConnectorEntry", () => {
  it("adds a space after the comma when the array already has one entry", () => {
    const source = "export default defineConfig({ connectors: [webConnector()] });";

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({
      status: "added",
      next: "export default defineConfig({ connectors: [queueConnector(), webConnector()] });",
    });
  });

  it("adds the bare call into an empty array", () => {
    const source = "export default defineConfig({ connectors: [] });";

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({
      status: "added",
      next: "export default defineConfig({ connectors: [queueConnector()] });",
    });
  });

  it("adds the entry on its own line, indented to match, in a multi-line array with a trailing comma", () => {
    const source = ["connectors: [", "  webConnector(),", "],"].join("\n");

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({
      status: "added",
      next: ["connectors: [", "  queueConnector(),", "  webConnector(),", "],"].join("\n"),
    });
  });

  it("adds the entry on its own line, indented to match, in a multi-line array with no trailing comma", () => {
    const source = ["connectors: [", "  webConnector()", "],"].join("\n");

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({
      status: "added",
      next: ["connectors: [", "  queueConnector(),", "  webConnector()", "],"].join("\n"),
    });
  });

  it("is idempotent — a connector already present is left unchanged", () => {
    const source = "export default defineConfig({ connectors: [queueConnector(), webConnector()] });";

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({ status: "already-present" });
  });

  it("reports unrecognised when there is no connectors array to patch", () => {
    const source = "export default defineConfig({});";

    const result = insertConnectorEntry(source, "queueConnector()");

    expect(result).toEqual({ status: "unrecognised" });
  });
});
