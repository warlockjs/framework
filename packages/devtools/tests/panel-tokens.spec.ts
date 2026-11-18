import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEVTOOLS_PANEL_TOKENS } from "../src/panel-tokens";

const root = path.resolve(import.meta.dirname, "..");
const stylesheet = readFileSync(path.join(root, "ui-src/src/styles.css"), "utf8");

/** The `--name: value` declarations of one top-level block (`:root` or `.dark`). */
function readBlock(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.]/g, "\\.");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet);

  if (!match) throw new Error(`styles.css has no ${selector} block`);

  const values = new Map<string, string>();

  for (const declaration of (match[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    values.set(declaration[1] as string, (declaration[2] as string).trim());
  }

  return values;
}

const themes = { light: readBlock(":root"), dark: readBlock(".dark") };

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);

  if (!match) throw new Error(`Expected a #rrggbb colour, got "${hex}"`);

  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt((match[1] as string).slice(index, index + 2), 16) / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];

  return (light + 0.05) / (dark + 0.05);
}

describe("panel token contract", () => {
  it("lists each token once", () => {
    expect(new Set(DEVTOOLS_PANEL_TOKENS).size).toBe(DEVTOOLS_PANEL_TOKENS.length);
  });

  for (const [theme, tokens] of Object.entries(themes)) {
    it(`defines every listed token in the ${theme} theme`, () => {
      const missing = DEVTOOLS_PANEL_TOKENS.filter(
        (name) => !tokens.has(name) && !(name === "--radius" && theme === "dark"),
      );

      expect(missing).toEqual([]);
    });
  }

  for (const [theme, tokens] of Object.entries(themes)) {
    const read = (name: string) => tokens.get(name) as string;

    describe(`contrast in the ${theme} theme`, () => {
      const text = [
        "--foreground",
        "--muted-foreground",
        "--brand",
        "--success",
        "--warning",
        "--info",
        "--destructive",
      ];

      for (const surface of ["--background", "--card"]) {
        for (const name of text) {
          it(`${name} on ${surface} is at least 4.5:1`, () => {
            expect(contrast(read(name), read(surface))).toBeGreaterThanOrEqual(4.5);
          });
        }
      }

      it("--muted-foreground on --muted is at least 4.5:1", () => {
        expect(contrast(read("--muted-foreground"), read("--muted"))).toBeGreaterThanOrEqual(4.5);
      });

      it("button text is readable on its fill", () => {
        expect(contrast(read("--primary-foreground"), read("--primary"))).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrast(read("--brand-foreground"), read("--brand"))).toBeGreaterThanOrEqual(4.5);
      });

      it("--border is visible on --background and --card (1.3:1)", () => {
        expect(contrast(read("--border"), read("--background"))).toBeGreaterThanOrEqual(1.3);
        expect(contrast(read("--border"), read("--card"))).toBeGreaterThanOrEqual(1.3);
      });
    });
  }
});

describe("built-in legacy panels", () => {
  const dir = path.join(root, "ui/panels");
  const files = readdirSync(dir).filter((name) => /\.(js|css)$/.test(name));

  it("finds the panel files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} uses only contract tokens or variables it defines`, () => {
      const source = readFileSync(path.join(dir, file), "utf8");
      const defined = new Set([...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
      const used = [...source.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] as string);
      const unknown = used.filter(
        (name) => !DEVTOOLS_PANEL_TOKENS.includes(name) && !defined.has(name),
      );

      expect(unknown).toEqual([]);
    });
  }
});
