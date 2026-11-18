import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_STYLE } from "./site";

const uiFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");

/**
 * The tokens the dashboard defines for panels, in light and dark. This list
 * mirrors devtools' `DEVTOOLS_PANEL_TOKENS`: change both together.
 */
const CONTRACT = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--brand",
  "--brand-foreground",
  "--success",
  "--warning",
  "--info",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];

const read = (name: string) => readFileSync(path.join(uiFolder, name), "utf8");

/** Every `var(--x)` a source reads. */
function usedVariables(source: string): string[] {
  return [
    ...new Set([...source.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] as string)),
  ];
}

/** Every `--gm-*` the stylesheet defines itself. */
function definedVariables(css: string): Set<string> {
  return new Set([...css.matchAll(/(--gm-[\w-]+)\s*:/g)].map((match) => match[1] as string));
}

describe("grimoire panel tokens", () => {
  const css = read("grimoire.css");
  const defined = definedVariables(css);

  for (const name of ["grimoire.css", "grimoire-view.js"]) {
    it(`${name} reads only contract tokens and its own --gm-* variables`, () => {
      const unknown = usedVariables(read(name)).filter(
        (variable) => !CONTRACT.includes(variable) && !defined.has(variable),
      );

      expect(unknown).toEqual([]);
    });
  }

  it("defines every --gm-* variable under the Grimoire root class", () => {
    expect(defined.size).toBeGreaterThan(0);
    expect([...defined].every((variable) => variable.startsWith("--gm-"))).toBe(true);
  });

  it("does not style dashboard class names", () => {
    expect(css).not.toMatch(/\.(card|badge|muted|good|bad)\b/);
  });

  it("the static page defines every contract token for light and dark", () => {
    const marker = "@media (prefers-color-scheme:dark)";
    const dark = PAGE_STYLE.indexOf(marker);

    expect(dark).toBeGreaterThan(0);

    const light = PAGE_STYLE.slice(0, dark);
    const night = PAGE_STYLE.slice(dark);

    for (const token of CONTRACT) {
      expect(light, `${token} (light)`).toMatch(new RegExp(`${token}:`));
      expect(night, `${token} (dark)`).toMatch(new RegExp(`${token}:`));
    }

    expect(PAGE_STYLE).not.toMatch(/--(text|line|surface|good|bad|warn|bar)\b/);
  });
});
