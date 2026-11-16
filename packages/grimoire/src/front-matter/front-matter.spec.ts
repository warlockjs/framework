import { describe, expect, it } from "vitest";
import { frontMatterList, frontMatterString, readFrontMatter } from "./index";

const FILE = "grimoire/features/catalog/README.md";

describe("readFrontMatter", () => {
  it("reads scalars, quoted values, inline lists and block lists with their lines", () => {
    const result = readFrontMatter(
      [
        "---",
        "id: catalog",
        'title: "Product catalog"',
        "apps: [web-client, mobile]",
        "folders:",
        "  - src/app/catalog",
        "  - 'src/web/$sites/client/products'",
        "empty: []",
        "---",
        "",
        "# Product catalog",
      ].join("\r\n"),
      FILE,
    );

    expect(result.errors).toEqual([]);
    expect(frontMatterString(result.fields, "id")).toBe("catalog");
    expect(frontMatterString(result.fields, "title")).toBe("Product catalog");
    expect(frontMatterList(result.fields, "apps")).toEqual(["web-client", "mobile"]);
    expect(result.fields?.get("folders")).toEqual({
      key: "folders",
      value: ["src/app/catalog", "src/web/$sites/client/products"],
      line: 5,
      itemLines: [6, 7],
    });
    expect(frontMatterList(result.fields, "empty")).toEqual([]);
    expect(frontMatterList(result.fields, "id")).toEqual(["catalog"]);
    expect(frontMatterString(result.fields, "missing")).toBeUndefined();
    expect(result.bodyStartLine).toBe(10);
    expect(result.body.split("\n")[1]).toBe("# Product catalog");
  });

  it("returns no front matter when the file does not start with ---", () => {
    const result = readFrontMatter("# Title\n", FILE);

    expect(result.fields).toBeNull();
    expect(result.bodyStartLine).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("reports an unclosed block, a bad line and a duplicate key as GR1002 with the line", () => {
    expect(readFrontMatter("---\nid: x\n", FILE).errors.map((error) => error.at?.line)).toEqual([
      1,
    ]);

    const result = readFrontMatter("﻿---\nid: x\nnot a pair\nid: y\n---\n", FILE);

    expect(result.errors.map((error) => [error.code, error.at?.line])).toEqual([
      ["GR1002", 3],
      ["GR1002", 4],
    ]);
    expect(result.errors[0]?.at?.file).toBe(FILE);
    expect(frontMatterString(result.fields, "id")).toBe("x");
  });
});
