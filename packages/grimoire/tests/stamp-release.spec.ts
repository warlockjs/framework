/**
 * `warlock grimoire release --stamp` on a copy of the shop fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { checkReleases, unreleasedEntries } from "../src/releases";
import { runStampRelease } from "../src/warlock/release-command";
import { parseGrimoire } from "../src/written";
import { createShopAdapter } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

const copies: FixtureCopy[] = [];

function fixture(): FixtureCopy {
  const copy = copyFixture();

  copies.push(copy);

  return copy;
}

afterEach(() => {
  for (const copy of copies.splice(0)) copy.remove();
});

function run(
  copy: FixtureCopy,
  release: string | undefined,
  options: Record<string, unknown> = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    out: (line: string) => void stdout.push(line),
    err: (line: string) => void stderr.push(line),
  };

  return runStampRelease(
    { root: copy.root, adapter: createShopAdapter(), io },
    release,
    options,
  ).then((code) => ({ code, stdout, stderr }));
}

const CATALOG = "grimoire/features/catalog/CHANGELOG.md";

describe("warlock grimoire release --stamp", () => {
  it("stamps the unreleased entries, writes the release file and collects", async () => {
    const copy = fixture();
    const before = copy.read(CATALOG);
    const result = await run(copy, "1.1.0", { date: "2026-11-24" });

    expect(result.code).toBe(0);
    expect(result.stdout[0]).toBe("stamped catalog → 1.1.0 (2026-11-24)");
    expect(result.stdout[1]).toBe("wrote grimoire/releases/1.1.0.md");
    expect(result.stdout[2]).toBe("grimoire/releases/1.1.0.md: 1 entry collected");
    expect(copy.read(CATALOG)).toBe(
      before.replace("## Unreleased\n", "## Unreleased\n\n## 1.1.0 (2026-11-24)\n"),
    );
    expect(copy.read("grimoire/releases/1.1.0.md")).toContain("Changes to ");
    expect(copy.read("grimoire/releases/1.1.0.md")).toContain("release: 1.1.0\ndate: 2026-11-24\n");

    const { written } = await parseGrimoire(copy.root);

    expect(unreleasedEntries(written)).toEqual([]);
    expect(checkReleases({ written } as Parameters<typeof checkReleases>[0])).toEqual([]);
  });

  it("takes the version from package.json and prints JSON on request", async () => {
    const copy = fixture();

    copy.write("package.json", JSON.stringify({ name: "shop", version: "1.2.0" }));

    const result = await run(copy, undefined, { date: "2026-11-24", json: true });
    const output = JSON.parse(result.stdout.join("\n"));

    expect(result.code).toBe(0);
    expect(output).toMatchObject({
      stamped: ["catalog"],
      created: "grimoire/releases/1.2.0.md",
      collect: { file: "grimoire/releases/1.2.0.md" },
    });
  });

  it("refuses with GR9006 and changes nothing for a missing version, a bad date or another date", async () => {
    const copy = fixture();
    const before = copy.read(CATALOG);
    const missing = await run(copy, undefined);
    const bad = await run(copy, "1.1.0", { date: "24/11/2026" });
    const other = await run(copy, "1.0.0", { date: "2026-11-24" });

    for (const result of [missing, bad, other]) {
      expect(result.code).toBe(1);
      expect(result.stderr[0]).toMatch(/^GR9006 /);
    }

    expect(other.stderr[0]).toContain("2026-10-01");
    expect(copy.read(CATALOG)).toBe(before);
  });
});
