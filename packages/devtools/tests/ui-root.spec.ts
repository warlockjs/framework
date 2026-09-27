import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveUiRoot } from "../src/ui-root";

describe("resolveUiRoot", () => {
  it("resolves to the package's ui/ directory from src", () => {
    const uiRoot = resolveUiRoot();

    expect(uiRoot).toBe(path.resolve(__dirname, "../ui"));
    expect(existsSync(path.join(uiRoot, "index.html"))).toBe(true);
  });

  it("caches the resolved path across calls", () => {
    expect(resolveUiRoot()).toBe(resolveUiRoot());
  });
});
