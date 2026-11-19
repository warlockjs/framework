import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS_MD_END, AGENTS_MD_START } from "./agents-md-markers";
import { createAgentsMdRefresher } from "./agents-md-refresher";
import { collectAgentsMdReport, collectDevModelModules } from "./collect-agents-md-report";
import { writeAgentsMd } from "./write-agents-md";

const { Order, loaded } = vi.hoisted(() => {
  class ProductModel {
    public static table = "products";
    public static query() {}
  }

  class OrderModel {
    public static table = "orders";
    public static query() {}
  }

  return {
    Product: ProductModel,
    Order: OrderModel,
    loaded: new Map<string, Record<string, unknown>>([
      ["/app/src/app/shop/models/product/product.model.ts", { Product: ProductModel }],
      ["/app/src/app/sales/models/order/order.model.ts", { Order: OrderModel }],
    ]),
  };
});

vi.mock("../../dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    files: new Map(
      [...loaded.keys()].map((absolutePath) => [
        absolutePath,
        { type: "model", absolutePath, relativePath: absolutePath.replace("/app/", "") },
      ]),
    ),
    moduleLoader: { getLoadedModule: (file: string) => loaded.get(file) },
  },
}));

const directories: string[] = [];

function project(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-agents-md-collect-"));
  directories.push(directory);
  mkdirSync(path.join(directory, "src", "app", "shop"), { recursive: true });
  mkdirSync(path.join(directory, "src", "app", "sales"), { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "demo" }));
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("one generator for every AGENTS.md writer", () => {
  it("reads the loaded model modules in the boot pass shape", () => {
    expect(collectDevModelModules().map((module) => module.file)).toEqual([
      "src/app/shop/models/product/product.model.ts",
      "src/app/sales/models/order/order.model.ts",
    ]);
  });

  it("makes the dev refresh write the same bytes as `agents-md --write`", async () => {
    const cwd = project();
    const file = path.join(cwd, "AGENTS.md");
    const hand = "# My notes\n\nKeep me.\n\n";

    writeFileSync(file, `${hand}${AGENTS_MD_START}\nold\n${AGENTS_MD_END}\n\nTail notes.\n`);

    // `warlock agents-md --write`: the boot pass supplies the model modules.
    const modelModules = collectDevModelModules();

    writeAgentsMd({ cwd, report: await collectAgentsMdReport({ cwd, modelModules }), skills: [] });
    const fromCommand = readFileSync(file, "utf8");

    writeFileSync(file, `${hand}${AGENTS_MD_START}\nstale\n${AGENTS_MD_END}\n\nTail notes.\n`);

    // The dev refresh: same collector, live modules.
    const refresher = createAgentsMdRefresher({
      cwd,
      collect: () => collectAgentsMdReport({ cwd, modelModules: collectDevModelModules() }),
    });

    await refresher.flush();
    const fromDev = readFileSync(file, "utf8");

    expect(fromDev).toBe(fromCommand);
    expect(Order.table).toBe("orders");
    expect(fromDev).toContain("| `shop` | 0 | 1 |");
    expect(fromDev).toContain("- `ProductModel` → `products` (module `shop`)");
    expect(fromDev.startsWith(hand)).toBe(true);
    expect(fromDev.endsWith("\n\nTail notes.\n")).toBe(true);
  });
});
