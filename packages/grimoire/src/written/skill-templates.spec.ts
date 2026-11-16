/**
 * The file templates in the package's skills are the fixed structure an agent
 * copies. Parse each one as written there (after the repository's formatter
 * has run over the skills) and expect no structure finding.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseGrimoire } from "./parse-grimoire";

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");

/** Every ```md block of every skill, its indentation removed. */
function templates(): string[] {
  const blocks: string[] = [];

  for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;

    const lines = readFileSync(path.join(skillsDir, skill.name, "SKILL.md"), "utf8").split("\n");
    let open: { indent: number; lines: string[] } | null = null;

    for (const line of lines) {
      const fence = /^( *)```(\w*)\s*$/.exec(line);

      if (open === null && fence && fence[2] === "md") {
        open = { indent: (fence[1] ?? "").length, lines: [] };
      } else if (open !== null && fence) {
        blocks.push(open.lines.join("\n") + "\n");
        open = null;
      } else if (open !== null) {
        open.lines.push(line.slice(open.indent));
      }
    }
  }

  return blocks;
}

/** Where a template goes in a project, from what it holds; `null` for fragments read elsewhere. */
function placeOf(block: string): string | null {
  const featureId = /^id: ([a-z0-9-]+)$/m.exec(block)?.[1];

  if (/^id: T-\d+$/m.test(block)) return "grimoire/tasks/open/T-014-wishlist.md";
  if (/^title: /m.test(block) && /^folders: /m.test(block) && featureId)
    return `grimoire/features/${featureId}/README.md`;
  if (/^since: /m.test(block)) return "grimoire/features/catalog/flows/wishlist.md";
  if (/^type: site$/m.test(block)) return "grimoire/apps/web-client/README.md";
  if (/^screen: /m.test(block)) return "grimoire/apps/mobile/screens/order-tracking/README.md";
  if (/^route: /m.test(block)) return "grimoire/apps/web-client/pages/home/README.md";
  if (/^flow: /m.test(block)) return "grimoire/apps/web-client/pages/home/blocks/new-arrivals.md";
  if (/^## \S+ \(\d{4}-\d{2}-\d{2}\)$/m.test(block))
    return "grimoire/features/catalog/CHANGELOG.md";
  if (/^release: /m.test(block)) return "grimoire/releases/1.4.1.md";

  return null;
}

/** Fragments: a section the skill shows on its own, and the file it belongs to. */
const FRAGMENTS: [RegExp, string][] = [
  [/^## Also reached from$/m, "grimoire/apps/web-client/pages/home/README.md"],
  [/^## Not handled$/m, "grimoire/features/catalog/flows/wishlist.md"],
];

describe("the skill templates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-skill-templates-"));

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("parse with no structure finding", async () => {
    const files = new Map<string, string>();
    const fragments: [string, string][] = [];

    for (const block of templates()) {
      const fragment = FRAGMENTS.find(([pattern]) => pattern.test(block));
      const place = placeOf(block);

      if (fragment) fragments.push([fragment[1], block]);
      else if (place !== null && !files.has(place)) {
        // A README shown as front matter only ("with these differences") gets a title.
        files.set(place, /^# /m.test(block) ? block : `${block}\n# A feature\n`);
      }
    }

    for (const [file, block] of fragments) files.set(file, `${files.get(file) ?? ""}\n${block}`);

    // The pieces the skills describe in words only.
    files.set("grimoire/features/catalog/versions/v3.md", "# Version 3\n\nA wishlist.\n");
    // Each other flow the README lists: the wishlist flow under its id.
    const flowSection = /^## Flows\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(
      files.get("grimoire/features/catalog/README.md") ?? "",
    );

    for (const [, id] of (flowSection?.[1] ?? "").matchAll(/^- ([a-z0-9-]+)\s/gm)) {
      const file = `grimoire/features/catalog/flows/${id}.md`;

      if (!files.has(file)) {
        files.set(
          file,
          (files.get("grimoire/features/catalog/flows/wishlist.md") ?? "").replace(
            "id: wishlist",
            `id: ${id}`,
          ),
        );
      }
    }
    files.set(
      "grimoire/apps/web-client/layouts/site.md",
      "# Site\n\n## Blocks\n\n| Block | Flow | Who sees it | Changes with |\n| --- | --- | --- | --- |\n| Cart | orders/place-order | customer | — |\n",
    );
    files.set(
      "grimoire/apps/mobile/README.md",
      "---\nid: mobile\ntype: mobile\nroot: mobile\n---\n\n# The app\n\n## Conditions\n\n- customer signed in\n",
    );

    expect([...files.keys()].filter((file) => !/\/flows\//.test(file)).sort()).toEqual([
      "grimoire/apps/mobile/README.md",
      "grimoire/apps/mobile/screens/order-tracking/README.md",
      "grimoire/apps/web-client/README.md",
      "grimoire/apps/web-client/layouts/site.md",
      "grimoire/apps/web-client/pages/home/README.md",
      "grimoire/apps/web-client/pages/home/blocks/new-arrivals.md",
      "grimoire/features/auth/README.md",
      "grimoire/features/catalog/CHANGELOG.md",
      "grimoire/features/catalog/README.md",
      "grimoire/features/catalog/versions/v3.md",
      "grimoire/releases/1.4.1.md",
      "grimoire/tasks/open/T-014-wishlist.md",
    ]);

    for (const [file, text] of files) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }

    const { written, findings } = await parseGrimoire(root);
    const catalog = written.features.find((feature) => feature.id === "catalog");
    const flow = catalog?.flows.find((item) => item.id.value === "wishlist");

    expect(findings.map((finding) => `${finding.code} ${finding.message}`)).toEqual([]);
    expect(flow?.steps).toHaveLength(4);
    expect(flow?.cases.filter((entry) => entry.fixed)).toHaveLength(8);
    expect(flow?.criteria).toHaveLength(4);
    expect(flow?.notHandled.map((line) => line.name)).toEqual(["double submit"]);
    expect(catalog?.changelog?.entries).toHaveLength(1);
    expect(written.apps.find((app) => app.id.value === "web-client")?.conditions).toHaveLength(4);
  });
});
