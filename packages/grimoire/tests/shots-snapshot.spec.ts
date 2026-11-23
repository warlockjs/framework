/**
 * `snapshot.settings` and `snapshot.shots` over the shop fixture, from the
 * full open and from the stored (read-only) open.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkGrimoire } from "../src/check";
import type { GrimoireSnapshot } from "../src/contracts/snapshot";
import { openGrimoire } from "../src/workspace";
import { openStoredGrimoire } from "../src/workspace/stored";
import { createShopAdapter, shopFacts } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

let copy: FixtureCopy;
let snapshot: GrimoireSnapshot;

const adapter = () =>
  createShopAdapter({ ...shopFacts, tests: [...shopFacts.tests, "e2e/shows.e2e.ts"] });

beforeAll(async () => {
  copy = copyFixture();
  copy.write("grimoire/settings.md", "---\nlanguages: [en, ar]\nscreenshots: all\n---\n");
  mkdirSync(path.join(copy.root, "grimoire", "approved"), { recursive: true });
  writeFileSync(path.join(copy.root, "grimoire", "approved", "api.json"), "{}\n");
  copy.write(
    "e2e/shows.e2e.ts",
    [
      "// @shows catalog/browse-products AC-1",
      'await shows(context, "catalog/browse-products AC-1", async () => {});',
      "// @shows catalog/browse-products AC-9",
      'await shows(context, "catalog/browse-products AC-9", async () => {});',
      "",
    ].join("\n"),
  );
  snapshot = await openGrimoire(copy.root, adapter(), { routes: "fresh" });
});

afterAll(() => copy.remove());

describe("settings and shots in the snapshot", () => {
  it("reads settings.md, and the walker accepts it and the approved folder", () => {
    expect(snapshot.written.settings?.file).toBe("grimoire/settings.md");
    expect(snapshot.settings).toMatchObject({
      languages: ["en", "ar"],
      languagesFrom: "settings",
      screenshots: "all",
    });
    expect(snapshot.structure.some((finding) => finding.code === "GR1020")).toBe(false);
  });

  it("reads the @shows lines and their findings", () => {
    expect(snapshot.shots?.mode).toBe("all");
    expect(snapshot.shots?.shows.map((line) => `${line.ref} ${line.criterion}`)).toEqual([
      "catalog/browse-products AC-1",
    ]);
    expect(snapshot.shots?.showsFindings.map((finding) => finding.code)).toEqual(["GR4014"]);
    expect(snapshot.shots?.baseline).toBeNull();
    expect(snapshot.shots?.drift).toEqual([]);
  });

  it("asks for a capture in each language the app has (GR4015)", () => {
    const report = checkGrimoire(snapshot);
    const missing = report.findings.filter((finding) => finding.code === "GR4015");

    expect(missing.map((finding) => finding.message).sort()).toEqual([
      "catalog/browse-products AC-1 is shown by a scene but has no capture in ar",
      "catalog/browse-products AC-1 is shown by a scene but has no capture in en",
    ]);
    expect(report.findings.some((finding) => finding.code === "GR4014")).toBe(true);
  });

  it("keeps settings and shots for the read-only open", async () => {
    const stored = await openStoredGrimoire(copy.root, adapter());

    expect(stored.settings).toEqual(snapshot.settings);
    expect(stored.shots).toEqual(snapshot.shots);
  });
});
