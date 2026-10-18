import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import published from "./fixtures/published-metrics";
import { fallbackMetrics, fallbackOverrides } from "./fallback";
import { prepareDevFonts, prepareFonts } from "./prepare-fonts";
import { readFontMetrics } from "./read-metrics";
import type { WebFont, WebFontFace } from "./types";

const fixture = (extension: string) =>
  readFileSync(new URL(`./fixtures/web-font-fixture.${extension}`, import.meta.url));
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function app() {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-fonts-"));
  directories.push(root);
  for (const directory of ["src/fonts", "public"])
    mkdirSync(path.join(root, directory), { recursive: true });
  for (const extension of ["ttf", "woff2"])
    copyFileSync(
      new URL(`./fixtures/web-font-fixture.${extension}`, import.meta.url),
      path.join(root, `src/fonts/display.${extension}`),
    );
  return root;
}
const criticalFace: WebFontFace = { path: "src/fonts/display.woff2", preload: true };
const declaration: WebFont = {
  family: "Display",
  variable: "--font-display",
  fallback: "Arial",
  files: [criticalFace],
};

function base128(value: number) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
  return Buffer.from(bytes);
}

describe("font metrics", () => {
  it.each(["ttf", "woff2"])(
    "reads the real OFL %s fixture against independently unpacked Capsize values",
    (extension) => {
      expect(readFontMetrics(fixture(extension))).toMatchObject({
        unitsPerEm: 2048,
        ascent: 1854,
        descent: -434,
        lineGap: 67,
        xWidthAvg: 913,
        widthSource: "hmtx",
        xAvgCharWidth: 1208,
        typo: { ascent: 1491, descent: -431, lineGap: 307 },
      });
    },
  );
  it("reads compressed WOFF tables and honors USE_TYPO_METRICS", () => {
    const ttf = fixture("ttf");
    const entries: { tag: Buffer; source: Buffer }[] = [];
    for (let i = 0; i < ttf.readUInt16BE(4); i++) {
      const pos = 12 + i * 16;
      const tag = ttf.subarray(pos, pos + 4);
      const offset = ttf.readUInt32BE(pos + 8);
      const source = Buffer.from(ttf.subarray(offset, offset + ttf.readUInt32BE(pos + 12)));
      if (tag.toString() === "OS/2") source.writeUInt16BE(source.readUInt16BE(62) | 128, 62);
      entries.push({ tag, source });
    }
    const header = Buffer.alloc(44 + entries.length * 20);
    header.write("wOFF");
    header.writeUInt16BE(entries.length, 12);
    let offset = header.length;
    const chunks: Buffer[] = [header];
    entries.forEach(({ tag, source }, index) => {
      const encoded = deflateSync(source);
      const compressed = encoded.length < source.length ? encoded : source;
      const pos = 44 + index * 20;
      tag.copy(header, pos);
      header.writeUInt32BE(offset, pos + 4);
      header.writeUInt32BE(compressed.length, pos + 8);
      header.writeUInt32BE(source.length, pos + 12);
      chunks.push(compressed);
      offset += compressed.length;
    });
    expect(readFontMetrics(Buffer.concat(chunks))).toMatchObject({
      ascent: 1491,
      descent: -431,
      lineGap: 307,
      xWidthAvg: 913,
    });
  });
  it("reads WOFF2 transformed hmtx advance widths without reconstructing outlines", () => {
    const ttf = fixture("ttf");
    const tags = new Map<string, Buffer>();
    for (let i = 0; i < ttf.readUInt16BE(4); i++) {
      const pos = 12 + i * 16;
      tags.set(
        ttf.toString("ascii", pos, pos + 4),
        ttf.subarray(
          ttf.readUInt32BE(pos + 8),
          ttf.readUInt32BE(pos + 8) + ttf.readUInt32BE(pos + 12),
        ),
      );
    }
    const hhea = tags.get("hhea");
    const original = tags.get("hmtx");
    if (!hhea || !original) throw new Error("missing fixture tables");
    const transformed = Buffer.alloc(1 + hhea.readUInt16BE(34) * 2);
    transformed[0] = 3;
    for (let i = 0; i < hhea.readUInt16BE(34); i++)
      transformed.writeUInt16BE(original.readUInt16BE(i * 4), 1 + i * 2);
    tags.set("hmtx", transformed);

    const directory: Buffer[] = [];
    const sources: Buffer[] = [];
    for (const tag of ["head", "hhea", "OS/2", "cmap", "hmtx"]) {
      const table = tags.get(tag);
      if (!table) throw new Error("missing fixture table");
      directory.push(
        Buffer.from([tag === "hmtx" ? 127 : 63]),
        Buffer.from(tag),
        base128(tag === "hmtx" ? original.length : table.length),
      );
      if (tag === "hmtx") directory.push(base128(table.length));
      sources.push(table);
    }
    const compressed = brotliCompressSync(Buffer.concat(sources));
    const header = Buffer.alloc(48);
    header.write("wOF2");
    header.writeUInt16BE(5, 12);
    header.writeUInt32BE(compressed.length, 20);
    expect(readFontMetrics(Buffer.concat([header, ...directory, compressed]))).toMatchObject({
      xWidthAvg: 913,
      widthSource: "hmtx",
    });
  });
  it.each([
    Buffer.alloc(0),
    Buffer.from("invalid font"),
    fixture("ttf").subarray(0, 60),
    fixture("woff2").subarray(0, 90),
  ])("rejects malformed input", (data) => {
    expect(() => readFontMetrics(data)).toThrow();
  });
});

describe("metric-matched fallbacks", () => {
  // Published inputs and Capsize's createFontStack formula, pinned in fixtures/README.md.
  it("matches Abel / Arial published metrics", () => {
    expect(fallbackOverrides(published.abel, published.arial)).toEqual({
      sizeAdjust: "85.7612%",
      ascentOverride: "114.2115%",
      descentOverride: "34.3887%",
      lineGapOverride: "0%",
    });
  });
  it("matches Roboto / Times New Roman published metrics", () => {
    expect(fallbackOverrides(published.roboto, published.timesNewRoman)).toEqual({
      sizeAdjust: "109.4952%",
      ascentOverride: "84.7283%",
      descentOverride: "22.2969%",
      lineGapOverride: "0%",
    });
  });
  it("selects actual local bold/italic faces with their own widths", () => {
    expect(
      fallbackMetrics("Arial", { path: "font.woff2", weight: 700, style: "italic" }),
    ).toMatchObject({
      fullName: "Arial Bold Italic",
      postscriptName: "Arial-BoldItalicMT",
      xWidthAvg: 983,
    });
    expect(fallbackOverrides(published.arial, published.arial).sizeAdjust).toBe("100%");
  });
});

describe("font declarations", () => {
  it("generates CSS stacks, per-face overrides, unicode subsets and deduplicated preloads", () => {
    const root = app();
    const result = prepareFonts(root, [
      {
        ...declaration,
        fallback: ["Arial", "Times New Roman"],
        files: [
          criticalFace,
          {
            path: "src/fonts/display.woff2",
            preload: true,
            weight: 700,
            style: "italic",
            unicodeRange: "U+0000-00FF",
          },
        ],
      },
    ]);
    expect(result.css).toContain("font-display:swap");
    expect(result.css).toContain(
      '--font-display:"Display","Display Fallback","Display Fallback 2","Arial","Times New Roman"',
    );
    expect(result.css).toContain('local("Arial Bold Italic")');
    expect(result.css).toContain("font-weight:700;font-style:italic;unicode-range:U+0000-00FF");
    expect(result.css).toContain("size-adjust:100%");
    expect(result.document.preloads).toHaveLength(1);
    expect(result.document.preloads[0]).toMatchObject({
      href: expect.stringMatching(/^\/assets\/font-[a-f0-9]{16}\.woff2$/),
      type: "font/woff2",
    });
    expect(result.document.stylesheetUrl).toMatch(/^\/assets\/font-[a-f0-9]{16}\.css$/);
    expect(result.diagnostics).toEqual([]);
  });
  it("hashes public fonts too and preserves explicit display", () => {
    const root = app();
    copyFileSync(
      path.join(root, "src/fonts/display.woff2"),
      path.join(root, "public/display.woff2"),
    );
    const source = prepareFonts(root, [declaration]);
    const publicFont = prepareFonts(root, [
      {
        ...declaration,
        display: "optional",
        files: [{ path: "public/display.woff2", preload: true }],
      },
    ]);
    expect(publicFont.document.preloads).toEqual(source.document.preloads);
    expect(publicFont.css).toContain("font-display:optional");
  });
  it("reports format, missing preload and missing critical fallback", () => {
    const result = prepareFonts(app(), [
      { ...declaration, fallback: [], files: [{ path: "src/fonts/display.ttf", aboveFold: true }] },
    ]);
    expect(result.diagnostics.map((item) => item.type)).toEqual(["format", "preload", "fallback"]);
  });
  it("caches development parsing and warnings, invalidating changed fonts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = app();
    const fonts: WebFont[] = [
      { ...declaration, files: [{ path: "src/fonts/display.ttf", aboveFold: true }] },
    ];
    const first = prepareDevFonts(root, fonts);
    expect(prepareDevFonts(root, fonts)).toBe(first);
    expect(warn).toHaveBeenCalledTimes(2);
    const source = readFileSync(path.join(root, "src/fonts/display.ttf"));
    writeFileSync(
      path.join(root, "src/fonts/display.ttf"),
      Buffer.concat([source, Buffer.alloc(4)]),
    );
    expect(prepareDevFonts(root, fonts)).not.toBe(first);
    expect(warn).toHaveBeenCalledTimes(4);
  });
  it("shares cached parsing and warnings across server module evaluations", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = app();
    const fonts: WebFont[] = [{ ...declaration, files: [{ path: "src/fonts/display.ttf" }] }];
    const first = prepareDevFonts(root, fonts);
    vi.resetModules();
    const reloaded = await import("./prepare-fonts");
    expect(reloaded.prepareDevFonts(root, fonts)).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("uses an explicit metricsPath when decoding a container fails", () => {
    const root = app();
    writeFileSync(path.join(root, "src/fonts/display.woff2"), "unsupported container");
    expect(() => prepareFonts(root, [declaration])).toThrow("metricsPath");
    expect(
      prepareFonts(root, [
        {
          ...declaration,
          files: [{ path: "src/fonts/display.woff2", metricsPath: "src/fonts/display.ttf" }],
        },
      ]).css,
    ).toContain("size-adjust:100%");
  });
  it.each([
    { variable: "--bad;property" },
    { display: "bad" },
    { files: [{ path: "../font.ttf" }] },
    { files: [{ path: "src/fonts/display.woff2", unicodeRange: "U+00; } body {" }] },
  ])("rejects invalid declarations", (overrides) => {
    expect(() => prepareFonts(app(), [{ ...declaration, ...overrides } as WebFont])).toThrow();
  });
});
