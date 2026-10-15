import { ai } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
// Importing the package barrel runs `./register` for its side effect,
// attaching `ai.tools.*` + `ai.mcp` onto the shared `ai` object.
import "./index";

/**
 * Smoke test for the registration seam: after importing the package, the
 * `ai.tools.*` factories and the `ai.mcp` factory (with its `.serve`
 * member) are present, callable, and produce the right runtime shapes. The
 * heavier per-tool behavior is covered by each tool's own `.spec.ts`; this
 * file only proves the wiring exists.
 */
describe("register", () => {
  it("attaches every ai.tools.* factory as a function", () => {
    expect(typeof ai.tools.webSearch).toBe("function");
    expect(typeof ai.tools.fetchUrl).toBe("function");
    expect(typeof ai.tools.http).toBe("function");
    expect(typeof ai.tools.calculator).toBe("function");
    expect(typeof ai.tools.dateTime).toBe("function");
  });

  it("attaches ai.mcp as a callable factory carrying .serve", () => {
    expect(typeof ai.mcp).toBe("function");
    expect(typeof ai.mcp.serve).toBe("function");
  });

  it("vends a ToolContract from each tool factory", () => {
    const contracts = [
      ai.tools.webSearch({ provider: "tavily" }),
      ai.tools.fetchUrl(),
      ai.tools.http(),
      ai.tools.calculator(),
      ai.tools.dateTime(),
    ];

    for (const contract of contracts) {
      expect(typeof contract.name).toBe("string");
      expect(typeof contract.execute).toBe("function");
      expect(typeof contract.invoke).toBe("function");
    }
  });

  it("exposes the default tool names through the registered factories", () => {
    expect(ai.tools.webSearch({ provider: "tavily" }).name).toBe("web_search");
    expect(ai.tools.fetchUrl().name).toBe("fetch_url");
    expect(ai.tools.http().name).toBe("http_request");
    expect(ai.tools.calculator().name).toBe("calculator");
    expect(ai.tools.dateTime().name).toBe("date_time");
  });
});
