import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  checkDevtoolsPanels,
  listPanelInfos,
  loadDevtoolsPanels,
  productionPanels,
} from "../../../src/panels";
import { DEVTOOLS_BUILT_IN_PANELS } from "../../../src/production/contracts";
import { createApp, mounted, testPanel } from "./harness";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "test-panel",
);
const view = path.join(fixtures, "view.js");

const panel = (id: string, production?: boolean) =>
  mounted([
    { id, title: id, view, ...(production === undefined ? {} : { production }) },
  ])[0] as ReturnType<typeof mounted>[number];

describe("productionPanels", () => {
  it("shows the built-in tabs the contract marks as on, in display order", () => {
    const { builtIn, panels } = productionPanels([]);

    expect(builtIn).toEqual([
      "requests",
      "queries",
      "routes",
      "resources",
      "health",
      "errors",
      "logs",
      "jobs",
    ]);
    expect(builtIn).toEqual(
      DEVTOOLS_BUILT_IN_PANELS.filter((tab) => tab.production).map((tab) => tab.id),
    );
    expect(panels).toEqual([]);
  });

  it("lets the project turn built-in tabs on and off", () => {
    const { builtIn } = productionPanels([], { mail: true, api: true, logs: false, health: false });

    expect(builtIn).toEqual([
      "requests",
      "queries",
      "routes",
      "resources",
      "errors",
      "jobs",
      "mail",
      "api",
    ]);
  });

  it("shows a package panel only when it declares production or the project turns it on", () => {
    const declared = panel("declared", true);
    const silent = panel("silent");
    const refused = panel("refused", false);

    expect(productionPanels([declared, silent, refused]).panels.map((item) => item.id)).toEqual([
      "declared",
    ]);
    expect(
      productionPanels([declared, silent, refused], { silent: true, refused: true }).panels.map(
        (item) => item.id,
      ),
    ).toEqual(["declared", "silent", "refused"]);
    expect(productionPanels([declared, silent], { declared: false }).panels).toEqual([]);
  });

  it("keeps the Processes panel off unless the project turns it on", () => {
    const processes = panel("processes");

    expect(productionPanels([processes]).panels).toEqual([]);
    expect(productionPanels([processes], { processes: true }).panels).toEqual([processes]);
  });
});

describe("panel descriptions", () => {
  it("records the production flag of a panel", () => {
    expect(panel("on", true).production).toBe(true);
    expect(panel("off", false).production).toBe(false);
    expect(panel("unset").production).toBe(false);
  });

  it.each(["resources", "health", "errors", "jobs", "instances", "auth", "account", "admin"])(
    "reserves the id %s for the dashboard",
    (id) => {
      expect(() => checkDevtoolsPanels([{ id, title: id, view }])).toThrow(
        /used by the dashboard itself/,
      );
    },
  );

  it("lists the enabled built-in tabs and then the package panels", () => {
    expect(listPanelInfos([panel("grimoire", true)], ["requests", "mail"])).toEqual([
      { id: "requests", title: "Requests", type: "built-in" },
      { id: "mail", title: "Mail", type: "built-in" },
      { id: "grimoire", title: "grimoire", type: "package" },
    ]);
    expect(listPanelInfos([]).map((tab) => tab.id)).toEqual(
      DEVTOOLS_BUILT_IN_PANELS.map((tab) => tab.id),
    );
  });
});

describe("panel factories", () => {
  it("receive the mode, development by default", async () => {
    const factory = vi.fn(() => ({ id: "one", title: "One", view }));
    const importModule = async () => ({ default: factory });
    const warn = vi.fn();

    await loadDevtoolsPanels(["./a"], { root: fixtures, warn, importModule });
    await loadDevtoolsPanels(["./a"], { root: fixtures, warn, importModule, mode: "production" });

    expect(factory).toHaveBeenNthCalledWith(1, { root: fixtures, mode: "development" });
    expect(factory).toHaveBeenNthCalledWith(2, { root: fixtures, mode: "production" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("carry the production flag through loading", async () => {
    const loaded = await loadDevtoolsPanels(["./a"], {
      root: fixtures,
      warn: vi.fn(),
      importModule: async () => ({
        default: { id: "flagged", title: "F", view, production: true },
      }),
    });

    expect(loaded[0]?.production).toBe(true);
  });
});

describe("panels in the production dashboard", () => {
  it("lists the enabled tabs and the package panels at GET api/panels", async () => {
    const t = await createApp({ panels: [testPanel()], builtInPanels: ["requests", "logs"] });
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("GET", "/api/panels", { session });

    expect(response.json()).toEqual([
      { id: "requests", title: "Requests", type: "built-in" },
      { id: "logs", title: "Logs", type: "built-in" },
      { id: "test-panel", title: "Test panel", type: "package" },
    ]);
  });

  it("serves the view module and assets to viewers only", async () => {
    const t = await createApp({ panels: [testPanel()], notFound: "custom" });
    const session = await t.signIn("viewer@example.com");

    expect((await t.send("GET", "/panels/test-panel/view.js", { session })).statusCode).toBe(200);
    expect((await t.send("GET", "/panels/test-panel/view.js")).body).toBe("app not found");
    expect((await t.send("GET", "/panels/test-panel/panel.ts", { session })).statusCode).toBe(404);
  });

  it("writes an audit entry for each successful panel write and none for reads", async () => {
    const t = await createApp({ panels: [testPanel()] });
    const admin = await t.signIn("admin@example.com", "admin");

    await t.send("GET", "/api/test-panel/search?q=a", { session: admin });

    const posted = await t.send("POST", "/api/test-panel/items", {
      session: admin,
      body: { a: 1 },
    });
    const deleted = await t.send("DELETE", "/api/test-panel/items", { session: admin });

    expect(posted.json()).toEqual({ received: { a: 1 } });
    expect(deleted.statusCode).toBe(204);

    await vi.waitFor(async () => {
      const entries = await t.store.audit.list({ types: ["panel.action"], limit: 10 });

      expect(entries).toHaveLength(2);
    });

    const entries = await t.store.audit.list({ types: ["panel.action"], limit: 10 });

    expect(entries.map((entry) => entry.detail.method).sort()).toEqual(["DELETE", "POST"]);
    expect(entries[0]?.detail).toMatchObject({
      panel: "test-panel",
      route: "/api/test-panel/items",
    });
    expect(entries[0]?.accountId).toBe(admin.accountId);
    expect(entries[0]?.ip).toBe("203.0.113.5");
  });

  it("does not audit a write that failed", async () => {
    const failing = testPanel({
      routes: [
        {
          method: "POST",
          path: "/items",
          handler: () => {
            throw Object.assign(new Error("No such entry."), { statusCode: 404 });
          },
        },
      ],
    });
    const t = await createApp({ panels: [failing] });
    const admin = await t.signIn("admin@example.com", "admin");
    const response = await t.send("POST", "/api/test-panel/items", { session: admin, body: {} });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "No such entry." });
    expect(await t.store.audit.list({ types: ["panel.action"], limit: 10 })).toEqual([]);
  });

  it("refuses panel writes from a viewer and without the CSRF token, and audits neither", async () => {
    const t = await createApp({ panels: [testPanel()] });
    const viewer = await t.signIn("viewer@example.com");
    const admin = await t.signIn("admin@example.com", "admin");
    const asViewer = await t.send("POST", "/api/test-panel/items", { session: viewer, body: {} });
    const noToken = await t.send("POST", "/api/test-panel/items", {
      session: { ...admin, csrf: "" },
      body: {},
    });

    expect(asViewer.json()).toMatchObject({ code: "role.forbidden" });
    expect(noToken.json()).toMatchObject({ code: "csrf.invalid" });
    expect(await t.store.audit.list({ types: ["panel.action"], limit: 10 })).toEqual([]);
  });

  it("audits EXPLAIN and clearing requests with their details", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");

    expect(
      (await t.send("POST", "/api/queries/abc123/explain", { session: admin, body: {} }))
        .statusCode,
    ).toBe(200);
    expect((await t.send("DELETE", "/api/requests", { session: admin })).statusCode).toBe(200);

    await vi.waitFor(async () => {
      expect(
        await t.store.audit.list({ types: ["explain.run", "requests.cleared"], limit: 10 }),
      ).toHaveLength(2);
    });

    const explain = await t.store.audit.list({ types: ["explain.run"], limit: 10 });

    expect(explain[0]?.detail).toEqual({ shapeId: "abc123" });
  });

  it("serves the route map", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");

    expect((await t.send("GET", "/api/routes", { session })).json()).toEqual([
      { method: "GET", path: "/app-route" },
    ]);
  });

  it("does not mount the development-only background route", async () => {
    const t = await createApp({ notFound: "custom" });
    const admin = await t.signIn("admin@example.com", "admin");

    expect((await t.send("GET", "/api/background", { session: admin })).statusCode).toBe(404);
  });
});
