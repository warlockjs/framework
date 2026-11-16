import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectedFiles, FeatureBookmap, FlowBookmap } from "../contracts";
import { writeCollectedFiles } from "./index";

let root: string;

const file = (relative: string): string => path.join(root, ...relative.split("/"));
const read = (relative: string): unknown => JSON.parse(readFileSync(file(relative), "utf8"));

function featureMap(feature: string): FeatureBookmap {
  return { schemaVersion: 1, feature, own: [], borrowed: [], routes: [], pages: {}, unreached: [] };
}

function flowMap(feature: string, flow: string): FlowBookmap {
  return {
    schemaVersion: 1,
    feature,
    flow,
    ref: `${feature}/${flow}`,
    steps: [],
    criteria: [],
    shownBy: [],
  };
}

function collected(features: Record<string, string[]>): CollectedFiles {
  const result: CollectedFiles = {
    features: {},
    flows: {},
    featuresIndex: { schemaVersion: 1, features: [] },
    tasksIndex: { schemaVersion: 1, open: [], waiting: [], done: [] },
  };

  for (const [feature, flows] of Object.entries(features)) {
    result.features[feature] = featureMap(feature);

    for (const flow of flows) result.flows[`${feature}/${flow}`] = flowMap(feature, flow);
  }

  return result;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "grimoire-collected-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("writeCollectedFiles", () => {
  it("writes book maps and indexes as JSON with a final newline", async () => {
    mkdirSync(file("grimoire/features/catalog/flows"), { recursive: true });
    mkdirSync(file("grimoire/tasks"), { recursive: true });

    const result = await writeCollectedFiles(root, collected({ catalog: ["browse"] }));

    expect(result).toEqual({
      written: [
        "grimoire/features/catalog/bookmap.json",
        "grimoire/features/catalog/flows/browse.bookmap.json",
        "grimoire/features/index.json",
        "grimoire/tasks/index.json",
      ],
      removed: [],
    });
    expect(readFileSync(file("grimoire/features/catalog/bookmap.json"), "utf8")).toBe(
      `${JSON.stringify(featureMap("catalog"), null, 2)}\n`,
    );
    expect(read("grimoire/tasks/index.json")).toEqual({
      schemaVersion: 1,
      open: [],
      waiting: [],
      done: [],
    });
  });

  it("rewrites nothing when nothing changed", async () => {
    mkdirSync(file("grimoire/tasks"), { recursive: true });
    await writeCollectedFiles(root, collected({ catalog: ["browse"] }));
    const before = statSync(file("grimoire/features/catalog/bookmap.json")).mtimeMs;

    const result = await writeCollectedFiles(root, collected({ catalog: ["browse"] }));

    expect(result).toEqual({ written: [], removed: [] });
    expect(statSync(file("grimoire/features/catalog/bookmap.json")).mtimeMs).toBe(before);
  });

  it("rewrites only the file whose content changed", async () => {
    await writeCollectedFiles(root, collected({ catalog: ["browse"], orders: ["place"] }));
    const next = collected({ catalog: ["browse"], orders: ["place"] });
    const orders = next.features.orders;

    if (orders) orders.unreached = ["src/app/orders/dead.ts"];

    expect((await writeCollectedFiles(root, next)).written).toEqual([
      "grimoire/features/orders/bookmap.json",
    ]);
  });

  it("removes the book maps of a deleted flow and a deleted feature, and their emptied folders", async () => {
    await writeCollectedFiles(root, collected({ catalog: ["browse", "wishlist"], gone: ["only"] }));
    writeFileSync(file("grimoire/features/catalog/README.md"), "agent file");
    writeFileSync(file("grimoire/features/catalog/flows/browse.md"), "agent file");

    const result = await writeCollectedFiles(root, collected({ catalog: ["browse"] }));

    expect(result.removed).toEqual([
      "grimoire/features/catalog/flows/wishlist.bookmap.json",
      "grimoire/features/gone/bookmap.json",
      "grimoire/features/gone/flows/only.bookmap.json",
    ]);
    expect(existsSync(file("grimoire/features/gone"))).toBe(false);
    expect(existsSync(file("grimoire/features/catalog/flows/browse.md"))).toBe(true);
    expect(existsSync(file("grimoire/features/catalog/README.md"))).toBe(true);
  });

  it("never touches files an agent wrote, even one named like an index in a feature folder", async () => {
    mkdirSync(file("grimoire/features/catalog/flows"), { recursive: true });
    writeFileSync(file("grimoire/features/catalog/notes.json"), "{}");
    writeFileSync(file("grimoire/features/catalog/flows/browse.md"), "agent file");

    await writeCollectedFiles(root, collected({}));

    expect(readFileSync(file("grimoire/features/catalog/notes.json"), "utf8")).toBe("{}");
    expect(readFileSync(file("grimoire/features/catalog/flows/browse.md"), "utf8")).toBe(
      "agent file",
    );
  });

  it("creates no grimoire folders for an empty project", async () => {
    const result = await writeCollectedFiles(root, collected({}));

    expect(result).toEqual({ written: [], removed: [] });
    expect(existsSync(file("grimoire"))).toBe(false);
  });
});
