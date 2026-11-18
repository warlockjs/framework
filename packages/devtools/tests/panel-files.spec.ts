import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PANEL_FILE_EXTENSIONS } from "../src/panels";
import { resolvePanelFile } from "../src/server/panel-files";

let root: string;
let files: { dir: string; extensions: readonly string[] };

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "devtools-files-"));
  mkdirSync(path.join(root, "shots", "sub"), { recursive: true });
  mkdirSync(path.join(root, "elsewhere"));
  writeFileSync(path.join(root, "shots", "a.png"), "a");
  writeFileSync(path.join(root, "shots", "A.PNG"), "upper");
  writeFileSync(path.join(root, "shots", "sub", "b.webp"), "b");
  writeFileSync(path.join(root, "shots", "vector.svg"), "<svg/>");
  writeFileSync(path.join(root, "elsewhere", "out.png"), "out");
  writeFileSync(path.join(root, "elsewhere", "page.html"), "<html>");
  // A sibling folder that shares the folder's name as a prefix.
  mkdirSync(path.join(root, "shots-private"));
  writeFileSync(path.join(root, "shots-private", "x.png"), "x");
  symlinkSync(path.join(root, "elsewhere", "out.png"), path.join(root, "shots", "escape.png"));
  symlinkSync(path.join(root, "elsewhere"), path.join(root, "shots", "dir-link"));
  symlinkSync(path.join(root, "shots", "a.png"), path.join(root, "shots", "inside.png"));
  symlinkSync(path.join(root, "elsewhere", "page.html"), path.join(root, "shots", "page.png"));
  files = { dir: path.join(root, "shots"), extensions: DEFAULT_PANEL_FILE_EXTENSIONS };
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const real = (name: string) => path.join(root, "shots", ...name.split("/"));

describe("resolvePanelFile", () => {
  it("resolves a listed image, in a subfolder too, and matches extensions in lower case", async () => {
    expect(await resolvePanelFile(files, "a.png")).toBe(real("a.png"));
    expect(await resolvePanelFile(files, "sub/b.webp")).toBe(real("sub/b.webp"));
    expect(await resolvePanelFile(files, "A.PNG")).toBe(real("A.PNG"));
  });

  it("follows a link that stays inside the folder", async () => {
    expect(await resolvePanelFile(files, "inside.png")).toBe(real("a.png"));
  });

  it.each([
    ["an empty path", ""],
    ["a parent segment", "../elsewhere/out.png"],
    ["a parent segment inside", "sub/../../elsewhere/out.png"],
    ["a dot segment", "./a.png"],
    ["an empty segment", "sub//b.webp"],
    ["an absolute path", "/etc/passwd"],
    ["a doubled slash", "//a.png"],
    ["a backslash", "sub\\b.webp"],
    ["a backslash parent", "..\\elsewhere\\out.png"],
    ["a drive letter", "C:\\windows\\win.ini"],
    ["a NUL byte", "a.png\0.txt"],
    ["a trailing slash", "sub/"],
    ["a folder", "sub"],
    ["an extension that is not listed", "vector.svg"],
    ["a missing file", "missing.png"],
    ["a link out of the folder", "escape.png"],
    ["a link to a folder outside", "dir-link/out.png"],
    ["a link to a page named like an image", "page.png"],
    ["a sibling folder with the same prefix", "../shots-private/x.png"],
    ["a path longer than 512 characters", `${"a/".repeat(300)}a.png`],
  ])("refuses %s", async (_name, requested) => {
    expect(await resolvePanelFile(files, requested)).toBeNull();
  });

  it("refuses anything that is not a string", async () => {
    expect(await resolvePanelFile(files, undefined)).toBeNull();
    expect(await resolvePanelFile(files, 5)).toBeNull();
    expect(await resolvePanelFile(files, ["a.png"])).toBeNull();
  });

  it("serves nothing from a folder that does not exist", async () => {
    expect(
      await resolvePanelFile({ dir: path.join(root, "nope"), extensions: [".png"] }, "a.png"),
    ).toBeNull();
  });

  it("serves only the extensions the panel lists", async () => {
    expect(await resolvePanelFile({ dir: files.dir, extensions: [".webp"] }, "a.png")).toBeNull();
    expect(await resolvePanelFile({ dir: files.dir, extensions: [".webp"] }, "sub/b.webp")).toBe(
      real("sub/b.webp"),
    );
  });
});
