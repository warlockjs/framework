import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPageFileChanges, isErrorPageFilePath } from "./page-file-change";

describe("forbidden.page.tsx reload tracking", () => {
  it("treats the forbidden page like the error page: tracked, never routed", () => {
    expect(isErrorPageFilePath("/app/src/web/forbidden.page.tsx")).toBe(true);
    expect(isErrorPageFilePath("/app/src/web/error.page.tsx")).toBe(true);
    expect(isErrorPageFilePath("/app/src/web/home.page.tsx")).toBe(false);
  });

  it("asks for inspection when the forbidden page changes and a removal when it is deleted", () => {
    const appRoot = path.resolve("/app");
    const file = path.join(appRoot, "src", "web", "forbidden.page.tsx");
    const options = {
      appRoot,
      appSrcRoot: "src",
      installedPageFiles: [] as string[],
    };

    expect(classifyPageFileChanges([file], { ...options, fileExists: () => true })).toEqual({
      added: [],
      removed: [],
      inspectionNeeded: [file],
    });
    expect(classifyPageFileChanges([file], { ...options, fileExists: () => false })).toEqual({
      added: [],
      removed: [file],
      inspectionNeeded: [],
    });
  });
});
