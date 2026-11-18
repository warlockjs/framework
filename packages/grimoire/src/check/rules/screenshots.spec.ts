import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { feature, flow, snapshot } from "../../../tests/check/snapshot-builder";
import type { GrimoireSnapshot, WrittenScreenshot } from "../../contracts";
import { checkScreenshots } from "./screenshots";

const root = mkdtempSync(path.join(tmpdir(), "grimoire-screenshots-"));

mkdirSync(path.join(root, "grimoire/screenshots/web"), { recursive: true });
writeFileSync(path.join(root, "grimoire/screenshots/web/home.png"), "png");
writeFileSync(path.join(root, "grimoire/screenshots/web/notes.txt"), "text");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function shot(imagePath: string | null, line: number): WrittenScreenshot {
  return {
    alt: "",
    written: imagePath ?? "../outside.png",
    path: imagePath,
    at: { file: "grimoire/features/shop/flows/order.md", line, column: null },
  };
}

function withShots(shots: WrittenScreenshot[]): GrimoireSnapshot {
  const target = snapshot({ root });
  const order = flow("shop", "order");

  order.story = shots.map((screenshots, index) => ({
    index: index + 1,
    text: "A step.",
    screenshots: [screenshots],
    at: screenshots.at,
  }));
  target.written.features = [feature("shop", { flows: [order] })];

  return target;
}

describe("checkScreenshots", () => {
  it("reports nothing for an existing image, and leaves a path outside the folder to the parser", () => {
    expect(checkScreenshots(withShots([shot("web/home.png", 5), shot(null, 6)]))).toEqual([]);
  });

  it("GR2014: a missing file and a type that is not an image", () => {
    const findings = checkScreenshots(
      withShots([shot("web/missing.png", 7), shot("web/notes.txt", 8), shot("web/home.png", 9)]),
    );

    expect(findings.map((finding) => [finding.code, finding.severity, finding.at?.line])).toEqual([
      ["GR2014", "warning", 7],
      ["GR2014", "warning", 8],
    ]);
    expect(findings[0]?.message).toContain("does not exist");
    expect(findings[1]?.message).toContain(".png");
    expect(findings[0]?.subject).toMatchObject({ feature: "shop", flow: "shop/order" });
  });

  it("checks the screenshots of pages, screens and blocks", () => {
    const target = snapshot({ root });

    target.written.apps = [
      {
        dir: "grimoire/apps/web",
        file: "grimoire/apps/web/README.md",
        id: { value: "web", at: { file: "grimoire/apps/web/README.md", line: 2, column: null } },
        pages: [
          {
            screenshots: [shot("web/gone.png", 3)],
            blockFiles: [{ screenshots: [shot("web/gone-block.png", 4)] }],
          },
        ],
        screens: [],
      },
    ] as unknown as GrimoireSnapshot["written"]["apps"];

    expect(checkScreenshots(target).map((finding) => [finding.code, finding.subject.app])).toEqual([
      ["GR2014", "web"],
      ["GR2014", "web"],
    ]);
  });
});
