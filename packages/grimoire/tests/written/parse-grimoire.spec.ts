/**
 * `parseGrimoire()` over whole projects: golden files of the parsed `shop`
 * and `written-messy` fixtures, the same result for CRLF files and trailing
 * spaces, and paths that read the same on every platform.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WrittenGrimoire } from "../../src/contracts/written";
import { parseGrimoire } from "../../src/written";
import { shopRoot } from "../fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../support/copy-fixture";

const messyRoot = path.join(path.dirname(shopRoot), "written-messy");
const copies: FixtureCopy[] = [];

function copy(source?: string): FixtureCopy {
  const fixture = copyFixture(source);
  copies.push(fixture);

  return fixture;
}

afterEach(() => {
  for (const fixture of copies.splice(0)) fixture.remove();
});

/** The parsed files without the parts that depend on where the project is. */
function portable(written: WrittenGrimoire): Omit<WrittenGrimoire, "root" | "hash"> {
  return {
    exists: written.exists,
    features: written.features,
    apps: written.apps,
    tasks: written.tasks,
    releases: written.releases,
  };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every Markdown file under `<root>/grimoire`, project-relative. */
function markdownFiles(root: string, dir = "grimoire"): string[] {
  const found: string[] = [];

  for (const name of readdirSync(path.join(root, dir))) {
    const file = `${dir}/${name}`;

    if (statSync(path.join(root, file)).isDirectory()) found.push(...markdownFiles(root, file));
    else if (name.endsWith(".md")) found.push(file);
  }

  return found;
}

describe("parseGrimoire on the shop fixture", () => {
  it("reads every written file with no structure finding", async () => {
    const { written, findings } = await parseGrimoire(shopRoot);

    expect(findings).toEqual([]);
    expect(written.exists).toBe(true);
    expect(written.root).toBe(path.resolve(shopRoot));
    expect(written.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.features.map((feature) => feature.id)).toEqual(["auth", "catalog", "orders"]);
    expect(written.apps.map((app) => app.id.value)).toEqual(["mobile", "web-admin", "web-client"]);
    expect(written.tasks.map((task) => task.id.value)).toEqual(["T-010", "T-014", "T-015"]);
    expect(written.releases.map((release) => release.release.value)).toEqual(["1.0.0"]);
  });

  it("matches the golden files", async () => {
    const { written } = await parseGrimoire(shopRoot);

    await expect(json(written.features)).toMatchFileSnapshot("../golden/written/shop.features.json");
    await expect(json(written.apps)).toMatchFileSnapshot("../golden/written/shop.apps.json");
    await expect(json(written.tasks)).toMatchFileSnapshot("../golden/written/shop.tasks.json");
    await expect(json(written.releases)).toMatchFileSnapshot("../golden/written/shop.releases.json");
  });

  it("reads the same project from CRLF files", async () => {
    const base = await parseGrimoire(shopRoot);
    const fixture = copy();

    for (const file of markdownFiles(fixture.root)) {
      fixture.write(file, fixture.read(file).replace(/\n/g, "\r\n"));
    }

    const crlf = await parseGrimoire(fixture.root);

    expect(crlf.findings).toEqual([]);
    expect(portable(crlf.written)).toEqual(portable(base.written));
    expect(crlf.written.hash).not.toBe(base.written.hash);
  });

  it("reads the same project with trailing spaces and extra blank lines at the end", async () => {
    const base = await parseGrimoire(shopRoot);
    const fixture = copy();

    for (const file of markdownFiles(fixture.root)) {
      fixture.write(file, `${fixture.read(file).replace(/\n/g, "  \n")}\n\n\n`);
    }

    const spaced = await parseGrimoire(fixture.root);

    expect(spaced.findings).toEqual([]);
    expect(portable(spaced.written)).toEqual(portable(base.written));
  });
});

describe("parseGrimoire on real-world Markdown", () => {
  it("reads `*` bullets, tabs, tables without outer pipes, fences and continuation lines (golden)", async () => {
    const { written, findings } = await parseGrimoire(messyRoot);

    expect(findings).toEqual([]);
    await expect(json(portable(written))).toMatchFileSnapshot("../golden/written/messy.json");
  });

  it("reads CRLF files of the messy fixture the same way", async () => {
    const base = await parseGrimoire(messyRoot);
    const fixture = copy(messyRoot);

    for (const file of markdownFiles(fixture.root)) {
      fixture.write(file, fixture.read(file).replace(/\n/g, "\r\n"));
    }

    const crlf = await parseGrimoire(fixture.root);

    expect(crlf.findings).toEqual([]);
    expect(portable(crlf.written)).toEqual(portable(base.written));
  });
});

describe("paths on every platform", () => {
  it("gives project-relative paths with `/` only, also for folders written with `\\`", async () => {
    const { written } = await parseGrimoire(messyRoot);
    const text = JSON.stringify(portable(written));

    expect(text).not.toContain("\\\\");
    expect(written.features[0]?.readme?.folders.map((folder) => folder.value)).toEqual([
      "src/app/search",
      "src/app/shared/search",
    ]);
    expect(written.apps[0]?.root.value).toBe("src/web");
  });

  it("accepts a relative root or one with a trailing separator", async () => {
    const absolute = await parseGrimoire(shopRoot);
    const relative = await parseGrimoire(path.relative(process.cwd(), shopRoot));
    const trailing = await parseGrimoire(`${shopRoot}${path.sep}`);

    expect(relative.written.root).toBe(absolute.written.root);
    expect(trailing.written.root).toBe(absolute.written.root);
    expect(relative.written).toEqual(absolute.written);
    expect(trailing.written).toEqual(absolute.written);
  });
});

describe("the written hash", () => {
  it("is stable, changes with a written file and ignores Warlock's files", async () => {
    const fixture = copy();
    const first = await parseGrimoire(fixture.root);

    expect((await parseGrimoire(fixture.root)).written.hash).toBe(first.written.hash);

    fixture.write("grimoire/features/catalog/bookmap.json", "{}\n");
    writeFileSync(path.join(fixture.root, "grimoire", "features", "index.json"), "{}\n");
    expect((await parseGrimoire(fixture.root)).written.hash).toBe(first.written.hash);

    fixture.replace("grimoire/features/catalog/README.md", "will save", "save");
    expect((await parseGrimoire(fixture.root)).written.hash).not.toBe(first.written.hash);
  });
});

describe("a project without a grimoire folder", () => {
  it("gives exists false, no findings and the hash of nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-empty-"));

    try {
      const { written, findings } = await parseGrimoire(root);

      expect(findings).toEqual([]);
      expect(written).toEqual({
        root: path.resolve(root),
        exists: false,
        features: [],
        apps: [],
        tasks: [],
        releases: [],
        hash: createHash("sha256").digest("hex"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a `grimoire` file (not a folder) the same way", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-file-"));

    try {
      writeFileSync(path.join(root, "grimoire"), "not a folder");

      expect((await parseGrimoire(root)).written.exists).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the fixtures stay as the goldens expect", () => {
  it("keeps LF line endings in the committed written files", () => {
    for (const root of [shopRoot, messyRoot]) {
      for (const file of markdownFiles(root)) {
        expect(readFileSync(path.join(root, file), "utf8"), file).not.toContain("\r");
      }
    }
  });
});
