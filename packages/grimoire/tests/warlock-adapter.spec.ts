/**
 * The Warlock adapter over small real Warlock apps: the files come from
 * core's `collectFiles()`, routes and events from a real `inspectApp()` over
 * in-process route records (the way core's inspect specs build their app
 * fixtures), pages from the web page graph, mobile screens from the folders.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectApp, type InspectOptions, type InspectSection } from "@warlock.js/core/tooling";
import { setConfig } from "@warlock.js/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookAdapter, BookFile } from "../src/contracts/adapter";
import { scry } from "../src/scry";
import { createWarlockAdapter } from "../src/warlock";
import { openGrimoire } from "../src/workspace";
import { shopFacts, shopRoot } from "./fixtures/shop-facts";

const here = path.dirname(fileURLToPath(import.meta.url));
const webPackage = path.resolve(here, "../../web");

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "mini-shop", version: "1.0.0", dependencies: { "@warlock.js/web": "*" } }),
  "src/app/orders/routes.ts": [
    "/** Registers the order routes. */",
    'import { router } from "@warlock.js/core";',
    'import { OrdersController } from "./controllers/orders.controller";',
    'import { listOrders } from "./controllers/list-orders.controller";',
    "",
    'router.post("/orders", [OrdersController, "store"]);',
    'router.get("/orders", listOrders);',
    "",
  ].join("\n"),
  "src/app/orders/controllers/orders.controller.ts": [
    "/**",
    " * Places orders.",
    " * @feature orders",
    " */",
    'import { placeOrder } from "../services/place-order.service";',
    "",
    "/** Takes a new order. */",
    "export class OrdersController {",
    "  public store() {",
    "    return placeOrder();",
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/app/orders/controllers/list-orders.controller.ts": [
    "/** Lists the customer's orders. */",
    "/** Returns the orders, newest first. */",
    "export function listOrders() {",
    "  return [];",
    "}",
    "",
  ].join("\n"),
  "src/app/orders/services/place-order.service.ts": [
    "/** Saves an order and sends the confirmation. */",
    'import { sendConfirmation } from "../mails/order-confirmation.mail";',
    "",
    "export function placeOrder() {",
    "  return sendConfirmation();",
    "}",
    "",
  ].join("\n"),
  "src/app/orders/mails/order-confirmation.mail.ts": "/** The order confirmation mail. */\nexport function sendConfirmation() {\n  return true;\n}\n",
  "src/app/orders/jobs/send-receipt.job.ts": "/** Sends the receipt. */\nexport const sendReceipt = {};\n",
  "src/app/orders/notifications/order-shipped.notification.ts": "/** Tells the customer the order shipped. */\nexport const orderShipped = {};\n",
  "src/app/orders/events/order-placed.event.ts": "/** Reacts to a placed order. */\nexport function onOrderPlaced() {}\n",
  "src/app/orders/tests/orders.test.ts": 'import { listOrders } from "../controllers/list-orders.controller";\n\nlistOrders();\n',
  "src/config/app.ts": "export default { name: 'mini' };\n",
  "src/web/$sites/client/root.tsx": "export default function Root() {\n  return null;\n}\n",
  "src/web/$sites/client/home.page.tsx": "/** The home page. */\nexport default function Home() {\n  return null;\n}\n",
  "src/web/$sites/admin/root.tsx": "export default function Root() {\n  return null;\n}\n",
  "src/web/$sites/admin/orders.page.tsx": "/** The orders list for staff. */\nexport default function Orders() {\n  return null;\n}\n",
  "mobile/app.json": "{}\n",
  "mobile/package.json": JSON.stringify({ name: "mini-mobile", dependencies: { "expo-router": "*" } }),
  "mobile/app/_layout.tsx": "export default function Layout() {\n  return null;\n}\n",
  "mobile/app/index.tsx": [
    "/** The home screen. */",
    'import { listOrders } from "../../src/app/orders/controllers/list-orders.controller";',
    "",
    "export default function Home() {",
    "  return listOrders();",
    "}",
    "",
  ].join("\n"),
  "e2e/checkout.e2e.ts": "export {};\n",
};

class OrdersController {
  public store(): undefined {
    return undefined;
  }
}

function listOrders(): undefined {
  return undefined;
}

function authGuard(): undefined {
  return undefined;
}

Object.defineProperty(authGuard, Symbol.for("warlock.auth"), { value: { sources: ["header"], userTypes: ["customer"] } });

const ROUTES = [
  {
    method: "POST",
    path: "/orders",
    name: "orders.place",
    handler: Object.getOwnPropertyDescriptor(OrdersController.prototype, "store")?.value,
    $controller: "OrdersController",
    $action: "store",
    middleware: [authGuard],
    sourceFile: "src/app/orders/routes.ts",
    $prefix: "/",
    $prefixStack: [],
  },
  { method: "GET", path: "/orders", name: "orders.list", handler: listOrders, sourceFile: "src/app/orders/routes.ts", $prefix: "/", $prefixStack: [] },
] as unknown as NonNullable<InspectOptions["routes"]>;

const EVENTS = [{ event: "order.placed", name: "onOrderPlaced", sourceFile: "src/app/orders/events/order-placed.event.ts" }];

let root: string;
let booted: InspectSection[][];
let adapter: BookAdapter;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "grimoire-adapter-"));

  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }

  mkdirSync(path.join(root, "node_modules", "@warlock.js"), { recursive: true });
  symlinkSync(webPackage, path.join(root, "node_modules", "@warlock.js", "web"), "junction");

  booted = [];
  adapter = createWarlockAdapter({
    inspect: (cwd, sections) => {
      booted.push([...sections]);

      return inspectApp({ cwd, sections, routes: ROUTES, events: EVENTS });
    },
  });
});

afterAll(() => {
  setConfig("web", undefined);
  rmSync(root, { recursive: true, force: true });
});

describe("createWarlockAdapter over a real app", () => {
  it("finds the source roots: src and the mobile app", async () => {
    expect(await adapter.sourceRoots(root)).toEqual(["src", "mobile"]);
  });

  it("maps collectFiles(): roles, headers, tags, export docs, imports across src and mobile", async () => {
    const files = await adapter.files(root);
    const byFile = new Map(files.map((file) => [file.file, file]));

    expect([...byFile.keys()]).toContain("mobile/app/index.tsx");
    expect([...byFile.keys()]).not.toContain("mobile/app.json");
    expect(byFile.get("src/app/orders/controllers/orders.controller.ts")).toMatchObject({
      module: "src/app/orders",
      type: "controller",
      about: "Places orders.",
      tags: { feature: ["orders"] },
      exports: [{ name: "OrdersController", about: "Takes a new order." }],
      mobileApp: null,
    });
    expect(byFile.get("mobile/app/index.tsx")).toMatchObject({
      module: "mobile/app",
      mobileApp: "mobile",
      imports: [{ specifier: "../../src/app/orders/controllers/list-orders.controller", file: "src/app/orders/controllers/list-orders.controller.ts" }],
    });
    expect(byFile.get("src/app/orders/controllers/list-orders.controller.ts")?.importedBy).toEqual([
      "mobile/app/index.tsx",
      "src/app/orders/routes.ts",
      "src/app/orders/tests/orders.test.ts",
    ]);
    expect(booted).toEqual([]);
  });

  it("reads routes from inspectApp with handler files resolved", async () => {
    const routes = await adapter.routes?.(root);

    expect([...(routes ?? [])].sort((left, right) => left.method.localeCompare(right.method)).reverse()).toEqual([
      {
        method: "POST",
        path: "/orders",
        name: "orders.place",
        sourceFile: "src/app/orders/routes.ts",
        handler: "OrdersController.store",
        controller: "OrdersController",
        action: "store",
        handlerFile: "src/app/orders/controllers/orders.controller.ts",
        middleware: ["authGuard"],
        auth: { required: true, userTypes: ["customer"] },
        isPage: false,
        description: null,
      },
      expect.objectContaining({
        method: "GET",
        path: "/orders",
        handler: "listOrders",
        controller: null,
        handlerFile: "src/app/orders/controllers/list-orders.controller.ts",
      }),
    ]);
    expect(booted).toContainEqual(["routes"]);
  });

  it("names mails, jobs, events and notifications", async () => {
    const named = await adapter.named?.(root);

    expect(named).toEqual(
      expect.arrayContaining([
        { type: "mail", name: "order-confirmation", file: "src/app/orders/mails/order-confirmation.mail.ts" },
        { type: "job", name: "send-receipt", file: "src/app/orders/jobs/send-receipt.job.ts" },
        { type: "event", name: "order.placed", file: "src/app/orders/events/order-placed.event.ts" },
        { type: "notification", name: "order-shipped", file: "src/app/orders/notifications/order-shipped.notification.ts" },
      ]),
    );
    expect(named).toHaveLength(4);
  });

  it("refuses the pages of a multi-site app while src/config/web.ts is not loaded", async () => {
    await expect(adapter.pages?.(root)).rejects.toThrow(/several sites .* need src\/config\/web\.ts/);
  });

  it("reads sites, pages (no boot), mobile screens and tests", async () => {
    booted.length = 0;
    setConfig("web", {
      sites: { client: { hosts: ["shop.test"] }, admin: { hosts: ["shop.test"], basePath: "/admin" } },
    });

    expect(await adapter.sites?.(root)).toEqual([
      { id: "admin", root: "src/web/$sites/admin", basePath: "/admin" },
      { id: "client", root: "src/web/$sites/client", basePath: null },
    ]);

    const pages = await adapter.pages?.(root);

    expect(pages?.map((page) => [page.site, page.route, page.file, page.reachedFrom])).toEqual([
      ["admin", "/admin/orders", "src/web/$sites/admin/orders.page.tsx", null],
      ["client", "/home", "src/web/$sites/client/home.page.tsx", null],
    ]);
    expect(await adapter.mobile?.(root)).toEqual([
      {
        id: "mobile",
        root: "mobile",
        routing: "files",
        routesDir: "mobile/app",
        screens: [{ route: "/", file: "mobile/app/index.tsx", layouts: ["mobile/app/_layout.tsx"] }],
      },
    ]);
    expect(await adapter.tests?.(root)).toEqual(["e2e/checkout.e2e.ts", "src/app/orders/tests/orders.test.ts"]);
    expect(booted).toEqual([]);
  });

  it("feeds the whole pipeline: a file-only open never boots, a route question works after a fresh one", async () => {
    booted.length = 0;

    const cached = await openGrimoire(root, adapter, { routes: "cached" });

    expect(cached.routes).toBe("missing");
    expect(scry(cached, { type: "file", file: "src/app/orders/services/place-order.service.ts" })).toMatchObject({
      entry: { importedBy: ["src/app/orders/controllers/orders.controller.ts"] },
    });
    expect(booted).toEqual([]);

    const fresh = await openGrimoire(root, adapter, { routes: "fresh" });
    const route = scry(fresh, { type: "route", method: "POST", path: "/orders" });

    expect(route.type === "route" && route.files).toEqual([
      "src/app/orders/controllers/orders.controller.ts",
      "src/app/orders/mails/order-confirmation.mail.ts",
      "src/app/orders/services/place-order.service.ts",
    ]);
  });
});

describe("createWarlockAdapter over the shop fixture", () => {
  it("reports the fixture's files with the same roles, headers, tags, exports and mobile app as its static facts", async () => {
    const shop = createWarlockAdapter({
      mobile: [{ root: "mobile", routing: "files" }],
      inspect: async () => {
        throw new Error("file facts must not boot");
      },
    });
    // The static facts resolve the `app/...` alias, which needs the app's tsconfig (the fixture has none),
    // and leave out the header sentence core also gives a default export.
    const project = (files: readonly BookFile[]) =>
      [...files]
        .sort((left, right) => (left.file < right.file ? -1 : 1))
        .map((file) => ({
          file: file.file,
          module: file.module,
          type: file.type,
          lines: file.lines,
          about: file.about,
          tags: file.tags,
          exports: file.exports.map((entry) => entry.name),
          relativeImports: file.imports.filter((entry) => entry.specifier.startsWith(".")),
          mobileApp: file.mobileApp,
        }));

    expect(project(await shop.files(shopRoot))).toEqual(project(shopFacts.files));
  });
});
