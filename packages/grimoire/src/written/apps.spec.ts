import { describe, expect, it } from "vitest";
import type { GrimoireFinding } from "../contracts/findings";
import {
  parseAppReadme,
  parseBlockFile,
  parseBlocksTable,
  parseLayout,
  parsePage,
  tableCells,
} from "./apps";
import { readDocument } from "./markdown";
import { FindingSink } from "./sink";

const PAGE = "grimoire/apps/web-client/pages/home/README.md";

function collect(): { sink: FindingSink; findings: GrimoireFinding[] } {
  const findings: GrimoireFinding[] = [];

  return { sink: new FindingSink(findings, { app: "web-client" }), findings };
}

function table(rows: string[]): { line: number; lines: ReturnType<typeof readDocument>["body"] } {
  const document = readDocument(PAGE, ["## Blocks", ...rows].join("\n"), "none", new FindingSink());

  return { line: 1, lines: document.sections[0]?.lines ?? [] };
}

describe("tableCells", () => {
  it("splits rows with or without outer pipes and keeps escaped pipes", () => {
    expect(tableCells("| a | b |")).toEqual(["a", "b"]);
    expect(tableCells("a | b")).toEqual(["a", "b"]);
    expect(tableCells("| a \\| x | b |")).toEqual(["a | x", "b"]);
  });
});

describe("parseBlocksTable", () => {
  it("reads flows, who sees it and changes with", () => {
    const { sink, findings } = collect();
    const rows = parseBlocksTable(
      PAGE,
      table([
        "Some text before the table.",
        "| block | FLOW | Who Sees It | Changes With |",
        "|:--|:-:|---|--:|",
        "| Featured | catalog/browse-products | everyone | vip: member prices; pref:personalised: picks |",
        "| Hint | — | guest, customer | the country |",
        "| Footer | - | everyone | – |",
        "",
        "| not | part | of | it |",
      ]),
      sink,
    );

    expect(findings).toEqual([]);
    expect(rows).toEqual([
      {
        block: "Featured",
        flow: "catalog/browse-products",
        who: { everyone: true, conditions: [] },
        changesWith: [
          { condition: "vip", text: "member prices" },
          { condition: "pref:personalised", text: "picks" },
        ],
        at: { file: PAGE, line: 5, column: null },
      },
      {
        block: "Hint",
        flow: null,
        who: { everyone: false, conditions: ["guest", "customer"] },
        changesWith: [{ condition: null, text: "the country" }],
        at: { file: PAGE, line: 6, column: null },
      },
      {
        block: "Footer",
        flow: null,
        who: { everyone: true, conditions: [] },
        changesWith: [],
        at: { file: PAGE, line: 7, column: null },
      },
    ]);
  });

  it.each([
    ["no table", ["just text"], 1],
    ["a wrong header", ["| Block | Flow | Who |", "|---|---|---|"], 2],
    [
      "no separator row",
      ["| Block | Flow | Who sees it | Changes with |", "| a | — | everyone | — |"],
      3,
    ],
  ])("reports %s as GR1018", (_name, rows, line) => {
    const { sink, findings } = collect();

    expect(parseBlocksTable(PAGE, table(rows), sink)).toEqual([]);
    expect(
      findings.map((finding) => [finding.code, finding.at?.line, finding.subject.app]),
    ).toEqual([["GR1018", line, "web-client"]]);
  });

  it("reports bad rows as GR1018 and keeps the good ones", () => {
    const { sink, findings } = collect();
    const rows = parseBlocksTable(
      PAGE,
      table([
        "| Block | Flow | Who sees it | Changes with |",
        "| --- | --- | --- | --- |",
        "| a | catalog | everyone | — |",
        "| b | — | everyone |",
        "|  | — | everyone | — |",
        "| c | — | — | — |",
        "| d | — | everyone | — |",
      ]),
      sink,
    );

    expect(rows.map((row) => row.block)).toEqual(["d"]);
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1018", 4],
      ["GR1018", 5],
      ["GR1018", 6],
      ["GR1018", 7],
    ]);
  });
});

describe("parseAppReadme", () => {
  const README = "grimoire/apps/web-client/README.md";

  it("reads the id, type, root (any separator) and conditions", () => {
    const { sink, findings } = collect();
    const app = parseAppReadme(
      README,
      "---\nid: web-client\ntype: site\nroot: .\\src\\web\\$sites\\client\\\n---\n# Site\n## Conditions\n- pref:personalised   on\n",
      "web-client",
      "site",
      sink,
    );

    expect(findings).toEqual([]);
    expect(app.root.value).toBe("src/web/$sites/client");
    expect(app.conditions.map((condition) => condition.name)).toEqual(["pref:personalised"]);
  });

  it("accepts origin on an app README, a layout, a page and a screen", () => {
    const { sink, findings } = collect();
    const app = parseAppReadme(
      README,
      "---\nid: web-client\ntype: site\nroot: src/web\norigin: inferred\n---\n# Site\n## Conditions\n- guest   a\n",
      "web-client",
      "site",
      sink,
    );
    const layout = parseLayout(
      "grimoire/apps/web-client/layouts/site.md",
      "---\norigin: confirmed\n---\n# Site\n## Blocks\n| Block | Flow | Who sees it | Changes with |\n|---|---|---|---|\n| Nav | — | everyone | — |\n",
      "web-client",
      "site",
      sink,
    );
    const page = parsePage(
      PAGE,
      "---\nroute: /\norigin: inferred\n---\n# Home\n",
      "web-client",
      "page",
      "home",
      sink,
    );
    const screen = parsePage(
      "grimoire/apps/mobile/screens/cart/README.md",
      "---\nscreen: Cart\norigin: inferred\n---\n# Cart\n",
      "mobile",
      "screen",
      "cart",
      sink,
    );

    expect(findings).toEqual([]);
    expect([
      app.origin?.value,
      layout.origin?.value,
      page.origin?.value,
      screen.origin?.value,
    ]).toEqual(["inferred", "confirmed", "inferred", "inferred"]);
  });

  it("reports a wrong type, an id that is not the folder name and a missing Conditions heading", () => {
    const { sink, findings } = collect();
    const app = parseAppReadme(
      README,
      "---\nid: client\ntype: web\nroot: src/web\n---\n# Site\n",
      "web-client",
      "mobile",
      sink,
    );

    expect(app.type.value).toBe("mobile");
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1019", 2],
      ["GR1006", 6],
      ["GR1004", 3],
    ]);
  });
});

describe("parseLayout, parsePage and parseBlockFile", () => {
  it("reads a layout's blocks and requires its Blocks heading", () => {
    const { sink, findings } = collect();
    const layout = parseLayout(
      "grimoire/apps/web-client/layouts/site.md",
      "# Site\n## Blocks\n",
      "web-client",
      "site",
      sink,
    );

    expect(layout.blocks).toEqual([]);
    expect(findings.map((finding) => finding.code)).toEqual(["GR1018"]);
  });

  it("reads a page's route, layout, purpose and entry points", () => {
    const { sink, findings } = collect();
    const page = parsePage(
      PAGE,
      "---\nroute: /\nlayout: site\n---\n# Home\nThe first page.\n## Also reached from\n- mail   order-confirmation\n- notification order-shipped\n- page\n",
      "web-client",
      "page",
      "home",
      sink,
    );

    expect(page.route?.value).toBe("/");
    expect(page.layout?.value).toBe("site");
    expect(page.purpose).toBe("The first page.");
    expect(page.alsoReachedFrom).toEqual([
      { type: "mail", name: "order-confirmation", at: { file: PAGE, line: 8, column: null } },
      { type: "notification", name: "order-shipped", at: { file: PAGE, line: 9, column: null } },
    ]);
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([["GR1028", 10]]);
  });

  it("requires a page route, and a screen route or screen name", () => {
    const { sink, findings } = collect();

    parsePage(PAGE, "---\nlayout: site\n---\n# Home\n", "web-client", "page", "home", sink);
    parsePage(
      "grimoire/apps/mobile/screens/home/README.md",
      "---\nlayout: site\n---\n# Home\n",
      "mobile",
      "screen",
      "home",
      sink,
    );
    const screen = parsePage(
      "grimoire/apps/mobile/screens/cart/README.md",
      "---\nscreen: Cart\n---\n# Cart\n",
      "mobile",
      "screen",
      "cart",
      sink,
    );

    expect(screen.screen?.value).toBe("Cart");
    expect(findings.map((finding) => [finding.code, finding.at?.file])).toEqual([
      ["GR1003", PAGE],
      ["GR1003", "grimoire/apps/mobile/screens/home/README.md"],
    ]);
  });

  it("reads a block file's flow and details", () => {
    const { sink, findings } = collect();
    const block = parseBlockFile(
      "grimoire/apps/web-client/pages/home/blocks/new-arrivals.md",
      "---\nflow: catalog\n---\n# New arrivals\n- position   second row\n",
      "web-client",
      "home",
      "new-arrivals",
      sink,
    );

    expect(block.details.map((detail) => [detail.name, detail.text])).toEqual([
      ["position", "second row"],
    ]);
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([["GR1004", 2]]);
  });
  it("reads the image lines of a page README: relative, absolute and outside the folder", () => {
    const { sink, findings } = collect();
    const page = parsePage(
      PAGE,
      [
        "---",
        "route: /",
        "---",
        "# Home",
        "![Hero](../../../../screenshots/web/home.png)",
        "The first page.",
        "![Absolute](/grimoire/screenshots/web/other.jpg)",
        "![Outside](../../../../images/home.png)",
        "![Web](https://example.com/a.png)",
        "```",
        "![Not read](../x.png)",
        "```",
      ].join("\n"),
      "web-client",
      "page",
      "home",
      sink,
    );

    expect(page.purpose).toBe("The first page.");
    expect(page.screenshots.map((shot) => [shot.alt, shot.path, shot.at.line])).toEqual([
      ["Hero", "web/home.png", 5],
      ["Absolute", "web/other.jpg", 7],
      ["Outside", null, 8],
      ["Web", null, 9],
    ]);
    expect(page.screenshots[0]?.written).toBe("../../../../screenshots/web/home.png");
    expect(findings.map((finding) => [finding.code, finding.severity, finding.at?.line])).toEqual([
      ["GR1029", "warning", 8],
      ["GR1029", "warning", 9],
    ]);
  });

  it("reads the image lines of a block file", () => {
    const { sink, findings } = collect();
    const block = parseBlockFile(
      "grimoire/apps/web-client/pages/home/blocks/new-arrivals.md",
      "---\nflow: catalog/new-arrivals\n---\n# New arrivals\n![Row](../../../../../screenshots/web/row.png)\n- position   second row\n",
      "web-client",
      "home",
      "new-arrivals",
      sink,
    );

    expect(findings).toEqual([]);
    expect(block.screenshots.map((shot) => [shot.alt, shot.path])).toEqual([
      ["Row", "web/row.png"],
    ]);
    expect(block.details.map((detail) => detail.name)).toEqual(["position"]);
  });

  it("a page with no image lines has no screenshots", () => {
    const { sink } = collect();
    const page = parsePage(
      PAGE,
      "---\nroute: /\n---\n# Home\n",
      "web-client",
      "page",
      "home",
      sink,
    );

    expect(page.screenshots).toEqual([]);
  });
});
