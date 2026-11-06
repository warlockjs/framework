import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPageFileGraph } from "./discover-pages";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeSrc(files: string[]): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-stray-layout-"));
  roots.push(appRoot);
  for (const file of files) {
    const full = path.join(appRoot, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "export default function X() { return null; }\n");
  }
  return path.join(appRoot, "src");
}

describe("layout.tsx outside the routed page tree", () => {
  it("warns about a layout.tsx no page sits beside or below, not about a routed one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const srcRoot = makeSrc([
      "src/web/root.tsx",
      "src/web/layout.tsx",
      "src/web/home.page.tsx",
      "src/web/themes/atelier/layout/layout.tsx",
    ]);

    discoverPageFileGraph(srcRoot);

    const warned = warn.mock.calls.map((call) => String(call[0])).join("\n");
    warn.mockRestore();

    expect(warned).toContain("themes/atelier/layout/layout.tsx");
    expect(warned).not.toContain("src/web/layout.tsx");
  });
});
