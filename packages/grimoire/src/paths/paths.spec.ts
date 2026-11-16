import { describe, expect, it } from "vitest";
import {
  bookEntryPath,
  bookEntryPaths,
  isInsideFolder,
  isReservedBookPath,
  moduleSummaryPath,
  projectPath,
  sitePagesPath,
  toPosixPath,
} from "./index";

describe("book paths", () => {
  it("mirrors src/ under grimoire/book with a .json extension", () => {
    expect(bookEntryPath({ file: "src/app/auth/controllers/login.controller.ts" })).toBe(
      "grimoire/book/app/auth/controllers/login.controller.json",
    );
    expect(bookEntryPath({ file: "src/web/$sites/client/home/home.page.tsx" })).toBe(
      "grimoire/book/web/$sites/client/home/home.page.json",
    );
    expect(bookEntryPath({ file: "src/app/shared/types.d.ts" })).toBe(
      "grimoire/book/app/shared/types.json",
    );
  });

  it("puts mobile files under mobile/<app>/", () => {
    expect(
      bookEntryPath({
        file: "mobile/app/products/[id].tsx",
        mobileApp: { id: "mobile", root: "mobile" },
      }),
    ).toBe("grimoire/book/mobile/mobile/app/products/[id].json");
  });

  it("keeps the full name on a collision or a reserved path", () => {
    const paths = bookEntryPaths([
      { file: "src/app/catalog/a.ts" },
      { file: "src/app/catalog/a.tsx" },
      { file: "src/app/catalog/b.ts" },
      { file: "src/app/routes.ts" },
    ]);

    expect(Object.fromEntries(paths)).toEqual({
      "src/app/catalog/a.ts": "grimoire/book/app/catalog/a.ts.json",
      "src/app/catalog/a.tsx": "grimoire/book/app/catalog/a.tsx.json",
      "src/app/catalog/b.ts": "grimoire/book/app/catalog/b.json",
      "src/app/routes.ts": "grimoire/book/app/routes.ts.json",
    });
    expect(isReservedBookPath(sitePagesPath("client"))).toBe(true);
  });

  it("handles both separators", () => {
    expect(toPosixPath("src\\app\\x.ts")).toBe("src/app/x.ts");
    expect(bookEntryPath({ file: "src\\app\\catalog\\x.ts" })).toBe("grimoire/book/app/catalog/x.json");
    expect(isInsideFolder("src\\app\\catalog\\x.ts", "src/app/catalog/")).toBe(true);
    expect(isInsideFolder("src/app/catalogue/x.ts", "src/app/catalog")).toBe(false);
    expect(projectPath("/project", "/project/src/app/x.ts")).toBe("src/app/x.ts");
    expect(moduleSummaryPath("src/app/catalog")).toBe("grimoire/book/app/catalog/index.md");
  });
});
