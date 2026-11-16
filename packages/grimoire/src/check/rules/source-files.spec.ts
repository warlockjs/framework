import { describe, expect, it } from "vitest";
import { bookFile, feature, snapshot } from "../../../tests/check/snapshot-builder";
import type { FileOwnership, GrimoireFinding, GrimoireSnapshot } from "../../contracts";
import { checkFolders, checkHeaders, checkOwners, checkUnreached } from "./source-files";

function summary(findings: GrimoireFinding[]): string[] {
  return findings.map(
    (finding) => `${finding.code} ${finding.at?.file}:${finding.at?.line} ${finding.message}`,
  );
}

function owned(
  file: string,
  owner: string | null,
  conflicts: FileOwnership["conflicts"] = [],
): FileOwnership {
  return { file, owner, via: owner ? "folder" : null, folder: null, conflicts, borrowedBy: [] };
}

describe("checkHeaders", () => {
  it("GR3001: a code file with no header sentence, except specs, types, locales, configs and .d.ts", () => {
    const target = snapshot();

    target.book.facts.files = [
      bookFile("src/app/shop/services/a.service.ts"),
      bookFile("src/app/shop/services/b.service.ts", { about: null }),
      bookFile("src/app/shop/tests/b.test.ts", { about: null, type: "spec" }),
      bookFile("src/app/shop/types.ts", { about: null, type: "type" }),
      bookFile("src/app/shop/locales.ts", { about: null, type: "locale" }),
      bookFile("src/config/app.ts", { about: null, type: "config" }),
      bookFile("src/env.d.ts", { about: null, type: "source" }),
    ];
    target.ownership.files["src/app/shop/services/b.service.ts"] = owned(
      "src/app/shop/services/b.service.ts",
      "shop",
    );

    const findings = checkHeaders(target);

    expect(summary(findings)).toEqual([
      "GR3001 src/app/shop/services/b.service.ts:1 src/app/shop/services/b.service.ts has no header sentence",
    ]);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      subject: { feature: "shop", file: "src/app/shop/services/b.service.ts" },
    });
  });
});

describe("checkOwners", () => {
  function ownersSnapshot(): GrimoireSnapshot {
    const target = snapshot();

    target.written.features = [feature("shop"), feature("auth")];
    target.book.facts.files = [
      bookFile("src/app/shop/a.ts"),
      bookFile("src/app/shared/utils/money.ts", { type: "util" }),
      bookFile("src/app/shop/main.ts", { type: "main" }),
      bookFile("src/web/home.page.tsx", { type: "page" }),
    ];
    target.ownership.files["src/app/shop/a.ts"] = owned("src/app/shop/a.ts", "shop");

    return target;
  }

  it("reports nothing when every src/app file has one owner and tags name features", () => {
    expect(checkOwners(ownersSnapshot())).toEqual([]);
  });

  it("GR3002: a src/app file no feature owns", () => {
    const target = ownersSnapshot();

    target.book.facts.files.push(bookFile("src/app/billing/pay.service.ts"));

    expect(summary(checkOwners(target))).toEqual([
      "GR3002 src/app/billing/pay.service.ts:1 src/app/billing/pay.service.ts belongs to no feature",
    ]);

    target.written.exists = false;
    target.written.features = [];

    expect(checkOwners(target)).toEqual([]);
  });

  it("GR3003: a file two features claim", () => {
    const target = ownersSnapshot();

    target.ownership.files["src/app/shop/a.ts"] = owned("src/app/shop/a.ts", null, [
      { feature: "shop", via: "folder" },
      { feature: "auth", via: "tag" },
    ]);

    expect(summary(checkOwners(target))).toEqual([
      "GR3003 src/app/shop/a.ts:1 src/app/shop/a.ts is claimed by shop (folder), auth (tag)",
    ]);
  });

  it("GR3004: a @feature tag naming no feature", () => {
    const target = ownersSnapshot();

    target.book.facts.files.push(
      bookFile("src/app/shared/jobs/clean.job.ts", {
        type: "job",
        tags: { feature: ["auth", "billing", "auth — the sign-up clean-up", "  "] },
      }),
    );

    expect(summary(checkOwners(target))).toEqual([
      "GR3004 src/app/shared/jobs/clean.job.ts:1 src/app/shared/jobs/clean.job.ts is tagged @feature billing, which is no feature",
    ]);
  });
});

describe("checkFolders", () => {
  function foldersSnapshot(folders: string[]): GrimoireSnapshot {
    const target = snapshot();

    target.written.features = [feature("shop", { folders })];
    target.book.facts.files = [bookFile("src/app/shop/a.ts")];
    target.book.manifest.files["src/web/shop/styles.css"] = {
      hash: "",
      size: 0,
      mtimeMs: 0,
      entry: null,
    };

    return target;
  }

  it("reports nothing when each folder holds a source file", () => {
    expect(
      checkFolders(
        foldersSnapshot([
          "src/app/shop",
          "src/web/shop/",
          "src\\app\\shop",
          "./src/app/shop",
          "src",
        ]),
      ),
    ).toEqual([]);
  });

  it("GR3005: a folders entry that does not exist", () => {
    expect(summary(checkFolders(foldersSnapshot(["src/app/shop", "src/app/sho"])))).toEqual([
      'GR3005 grimoire/features/shop/README.md:8 folders entry "src/app/sho" of shop holds no source file',
    ]);
  });
});

describe("checkUnreached", () => {
  function unreachedSnapshot(unreached: string[]): GrimoireSnapshot {
    const target = snapshot();

    target.collected.features["shop"] = {
      schemaVersion: 1,
      feature: "shop",
      own: ["src/app/shop/a.ts", "src/app/shop/old.ts"],
      borrowed: [],
      routes: [],
      pages: {},
      unreached,
    };

    return target;
  }

  it("reports nothing when every own file is reached", () => {
    expect(checkUnreached(unreachedSnapshot([]))).toEqual([]);
  });

  it("GR3006: an own file no flow reaches", () => {
    const findings = checkUnreached(unreachedSnapshot(["src/app/shop/old.ts"]));

    expect(summary(findings)).toEqual([
      "GR3006 src/app/shop/old.ts:1 src/app/shop/old.ts is owned by shop, but no flow of shop reaches it",
    ]);
    expect(findings[0]).toMatchObject({ severity: "warning", subject: { feature: "shop" } });
  });
});
