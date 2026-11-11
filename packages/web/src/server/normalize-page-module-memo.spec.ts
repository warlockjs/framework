import { describe, expect, it } from "vitest";
import { normalizePageModule } from "./normalize-page-module";

const Page = () => null;

describe("normalizePageModule — one validation per namespace", () => {
  it("returns the same normalized module for the same namespace, kind and source file", () => {
    const raw = { config: { metadata: { title: "Products" } }, default: Page };

    const first = normalizePageModule(raw, "page", "src/web/products.page.tsx");

    expect(normalizePageModule(raw, "page", "src/web/products.page.tsx")).toBe(first);
    expect(first).toEqual({ default: Page, metadata: { title: "Products" } });
  });

  it("validates a new namespace object anew, the way a development reload hands one", () => {
    const before = { config: { metadata: { title: "Before" } }, default: Page };
    const after = { config: { metadata: { title: "After" } }, default: Page };

    const first = normalizePageModule(before, "page", "src/web/products.page.tsx");
    const second = normalizePageModule(after, "page", "src/web/products.page.tsx");

    expect(second).not.toBe(first);
    expect(second.metadata).toEqual({ title: "After" });
  });

  it("keeps the source file in the key, so a metadata function reports the file it came from", () => {
    const raw = { config: { metadata: () => ({ title: 1 }) }, default: Page };

    const first = normalizePageModule(raw, "page", "src/web/first.page.tsx");
    const second = normalizePageModule(raw, "page", "src/web/second.page.tsx");

    expect(second).not.toBe(first);
    expect(() => (second.metadata as (context: unknown) => unknown)({})).toThrow(
      "src/web/second.page.tsx",
    );
  });

  it("never stores a namespace that fails, so it fails again with the same message", () => {
    const raw = { config: { unknownKey: true }, default: Page };

    expect(() => normalizePageModule(raw, "page", "src/web/bad.page.tsx")).toThrow("unknownKey");
    expect(() => normalizePageModule(raw, "page", "src/web/bad.page.tsx")).toThrow("unknownKey");
  });
});
