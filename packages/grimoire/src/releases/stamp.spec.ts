import { describe, expect, it } from "vitest";
import { GrimoireError } from "../codes";
import type { WrittenGrimoire } from "../contracts/written";
import { planStamp } from "./stamp";

const at = (file: string, line = 1) => ({ file, line, column: null });
const located = <T>(value: T) => ({ value, at: at("x.md") });

type Section = { release: string | null; date: string | null };

function feature(id: string, title: string, sections: Section[], unreleased: number) {
  const file = `grimoire/features/${id}/CHANGELOG.md`;

  return {
    id,
    readme: { title: located(title) },
    changelog: {
      file,
      sections: sections.map((section) => ({ ...section, at: at(file) })),
      entries: Array.from({ length: unreleased }, () => ({ release: null })),
    },
  };
}

function written(features: unknown[], releases: { release: string; date: string }[] = []) {
  return {
    features,
    releases: releases.map((item) => ({
      file: `grimoire/releases/${item.release}.md`,
      release: located(item.release),
      date: located(item.date),
    })),
  } as unknown as WrittenGrimoire;
}

const CATALOG = [
  "## Unreleased",
  "- 2.1  fixed     new-arrivals: a customer with no country saw an empty list",
  "                 instead of the global one (AC-2)",
  "",
  "## 1.0.0 (2026-10-01)",
  "- 2.0  added     new-arrivals: customers see the newest products",
  "",
].join("\n");

const ORDERS = [
  "# Changelog",
  "",
  "## Unreleased",
  "- 1.1  added  place-order: gift notes",
  "",
].join("\n");
const AUTH = ["## Unreleased", "", "## 1.0.0 (2026-10-01)", "- 1.0  added  described", ""].join(
  "\n",
);

const TEXTS = {
  "grimoire/features/catalog/CHANGELOG.md": CATALOG,
  "grimoire/features/orders/CHANGELOG.md": ORDERS,
  "grimoire/features/auth/CHANGELOG.md": AUTH,
};

const FEATURES = [
  feature(
    "auth",
    "Sign in",
    [
      { release: null, date: null },
      { release: "1.0.0", date: "2026-10-01" },
    ],
    0,
  ),
  feature(
    "catalog",
    "Catalog",
    [
      { release: null, date: null },
      { release: "1.0.0", date: "2026-10-01" },
    ],
    1,
  ),
  feature("orders", "Orders", [{ release: null, date: null }], 1),
];

function refusal(run: () => unknown): GrimoireError {
  try {
    run();
  } catch (error) {
    if (error instanceof GrimoireError) return error;
  }

  throw new Error("expected a GrimoireError");
}

describe("planStamp", () => {
  it("stamps the features with unreleased entries and leaves every other byte alone", () => {
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written(FEATURES),
      texts: TEXTS,
    });

    expect(plan.changelogs.map((item) => item.feature)).toEqual(["catalog", "orders"]);
    expect(plan.changelogs[0]?.text).toBe(
      [
        "## Unreleased",
        "",
        "## 1.4.0 (2026-11-24)",
        "- 2.1  fixed     new-arrivals: a customer with no country saw an empty list",
        "                 instead of the global one (AC-2)",
        "",
        "## 1.0.0 (2026-10-01)",
        "- 2.0  added     new-arrivals: customers see the newest products",
        "",
      ].join("\n"),
    );
    expect(plan.changelogs[1]?.text).toBe(
      [
        "# Changelog",
        "",
        "## Unreleased",
        "",
        "## 1.4.0 (2026-11-24)",
        "- 1.1  added  place-order: gift notes",
        "",
      ].join("\n"),
    );
  });

  it("keeps CRLF line endings", () => {
    const crlf = ORDERS.split("\n").join("\r\n");
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written([FEATURES[2]]),
      texts: { "grimoire/features/orders/CHANGELOG.md": crlf },
    });

    expect(plan.changelogs[0]?.text).toBe(
      [
        "# Changelog",
        "",
        "## Unreleased",
        "",
        "## 1.4.0 (2026-11-24)",
        "- 1.1  added  place-order: gift notes",
        "",
      ].join("\r\n"),
    );
  });

  it("creates the release file with front matter and a brief naming the changed features", () => {
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written(FEATURES),
      texts: TEXTS,
    });

    expect(plan.release).toEqual({
      file: "grimoire/releases/1.4.0.md",
      text: "---\nrelease: 1.4.0\ndate: 2026-11-24\n---\n\n# Release 1.4.0\n\nChanges to Catalog and Orders.\n",
    });
  });

  it("keeps an existing release file", () => {
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written(FEATURES, [{ release: "1.4.0", date: "2026-11-24" }]),
      texts: TEXTS,
    });

    expect(plan.release).toBeNull();
  });

  it("moves unreleased entries into an existing section of the same version and date", () => {
    const text = [
      "## Unreleased",
      "- 2.2  fixed  late fix",
      "",
      "## 1.4.0 (2026-11-24)",
      "- 2.1  added  earlier entry",
      "",
    ].join("\n");
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written([
        feature(
          "catalog",
          "Catalog",
          [
            { release: null, date: null },
            { release: "1.4.0", date: "2026-11-24" },
          ],
          1,
        ),
      ]),
      texts: { "grimoire/features/catalog/CHANGELOG.md": text },
    });

    expect(plan.changelogs[0]?.text).toBe(
      [
        "## Unreleased",
        "",
        "## 1.4.0 (2026-11-24)",
        "- 2.2  fixed  late fix",
        "- 2.1  added  earlier entry",
        "",
      ].join("\n"),
    );
  });

  it("stamps nothing and still plans the release file when no changelog has unreleased entries", () => {
    const plan = planStamp({
      version: "1.4.0",
      date: "2026-11-24",
      written: written([FEATURES[0]]),
      texts: TEXTS,
    });

    expect(plan.changelogs).toEqual([]);
    expect(plan.release?.text).toContain("No feature changes in this release.");
  });

  it("refuses a bad date and a version section with another date", () => {
    expect(
      refusal(() =>
        planStamp({
          version: "1.4.0",
          date: "24-11-2026",
          written: written(FEATURES),
          texts: TEXTS,
        }),
      ).code,
    ).toBe("GR9006");

    const other = written([
      feature(
        "catalog",
        "Catalog",
        [
          { release: null, date: null },
          { release: "1.4.0", date: "2026-11-01" },
        ],
        1,
      ),
    ]);
    const error = refusal(() =>
      planStamp({ version: "1.4.0", date: "2026-11-24", written: other, texts: TEXTS }),
    );

    expect(error.code).toBe("GR9006");
    expect(error.message).toContain("2026-11-01");
  });
});
