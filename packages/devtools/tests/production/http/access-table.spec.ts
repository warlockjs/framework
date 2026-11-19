import { describe, expect, it } from "vitest";
import { createAccessLookup, productionRouteAccess } from "../../../src/production/http/access";
import type { DevtoolsRouteAccessRule } from "../../../src/production/http";
import { createApp, PASSWORD, testPanel, type TestApp } from "./harness";

const ALL_TABS = [
  "requests",
  "queries",
  "routes",
  "resources",
  "health",
  "errors",
  "logs",
  "jobs",
  "mail",
  "ai-reports",
  "ai",
  "agents",
  "ai-models",
  "ai-errors",
  "ai-evaluate",
  "api",
];

type Cell = "anonymous" | "password-change" | "mfa-verify" | "viewer" | "admin";
type Outcome = "hidden" | "forbidden" | "passed";

let counter = 0;

type Session = { token: string; csrf: string; accountId: string };

/** Fresh accounts in each state a visitor can be in. */
async function sessionSet(t: TestApp): Promise<Record<Cell, Session | null>> {
  counter += 1;

  const tokenOf = (response: { headers: Record<string, unknown> }): string =>
    /warlock-devtools=([^;]+)/.exec(String(response.headers["set-cookie"]))?.[1] ?? "";
  const login = async (email: string) => {
    const response = await t.send("POST", "/api/auth/login", {
      body: { email, password: PASSWORD },
    });
    const step = response.json<{ stage: string; csrf: string }>();

    return { token: tokenOf(response), step };
  };

  await t.addAccount(`pw${counter}@example.com`, "viewer", {
    passwordSource: "reset",
    mustChangePassword: true,
  });
  await t.addAccount(`mfa${counter}@example.com`, "admin");

  const pw = await login(`pw${counter}@example.com`);
  const mfa = await login(`mfa${counter}@example.com`);
  const viewer = await t.signIn(`viewer${counter}@example.com`, "viewer");
  const admin = await t.signIn(`admin${counter}@example.com`, "admin");

  return {
    anonymous: null,
    "password-change": { token: pw.token, csrf: pw.step.csrf, accountId: "" },
    "mfa-verify": { token: mfa.token, csrf: mfa.step.csrf, accountId: "" },
    viewer,
    admin,
  };
}

function concrete(url: string): string {
  return url
    .replace(":shapeId", "abc123")
    .replace(":name", "app.js")
    .replace(":id/", "x/")
    .replace(/:id$/, "x")
    .replace(":id", "x");
}

function classify(response: {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}): Outcome {
  // The gate's 404 is the app's own and carries no dashboard header; a handler's 404 does.
  if (response.statusCode === 404 && response.headers["x-robots-tag"] === undefined)
    return "hidden";

  if (response.statusCode === 403 && response.body.includes("role.forbidden")) return "forbidden";

  return "passed";
}

function expected(rule: DevtoolsRouteAccessRule, cell: Cell): Outcome {
  const access = rule.access;

  if (access.type === "public") return "passed";
  if (cell === "anonymous") return "hidden";

  if (access.type === "pending") {
    if (cell === "viewer" || cell === "admin") return "passed";

    return (access.stages as readonly string[]).includes(cell) ? "passed" : "hidden";
  }

  if (cell === "password-change" || cell === "mfa-verify") return "hidden";
  if (access.type === "admin" && cell === "viewer") return "forbidden";

  return "passed";
}

describe("productionRouteAccess", () => {
  const rules = productionRouteAccess(["grimoire"]);
  const find = (method: string, url: string) =>
    rules.find((rule) => rule.method === method && rule.url === url);

  it("lists every route once", () => {
    const keys = rules.map((rule) => `${rule.method} ${rule.url}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("makes the shell, its assets, the session view and the sign-in entry points public", () => {
    for (const [method, url] of [
      ["GET", "/"],
      ["GET", "/assets/:name"],
      ["GET", "/api/auth/session"],
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/setup"],
      ["POST", "/api/auth/invite/inspect"],
      ["POST", "/api/auth/invite/accept"],
    ] as const) {
      expect(find(method, url)?.access, `${method} ${url}`).toEqual({ type: "public" });
    }
  });

  it("limits each sign-in step to the stages that need it", () => {
    expect(find("POST", "/api/auth/password")?.access).toEqual({
      type: "pending",
      stages: ["password-change"],
    });
    expect(find("POST", "/api/auth/totp/start")?.access).toEqual({
      type: "pending",
      stages: ["mfa-enrol"],
    });
    expect(find("POST", "/api/auth/totp/confirm")?.access).toEqual({
      type: "pending",
      stages: ["mfa-enrol"],
    });
    expect(find("POST", "/api/auth/passkey/options")?.access).toEqual({
      type: "pending",
      stages: ["mfa-enrol", "mfa-verify"],
    });
    expect(find("POST", "/api/auth/passkey/verify")?.access).toEqual({
      type: "pending",
      stages: ["mfa-enrol", "mfa-verify"],
    });
    expect(find("POST", "/api/auth/mfa")?.access).toEqual({
      type: "pending",
      stages: ["mfa-verify"],
    });
    expect(find("POST", "/api/auth/logout")?.access).toEqual({
      type: "pending",
      stages: ["password-change", "mfa-enrol", "mfa-verify"],
    });
  });

  it("gives viewers the read routes and the account", () => {
    for (const [method, url] of [
      ["GET", "/api/panels"],
      ["GET", "/api/account"],
      ["GET", "/api/stream"],
      ["GET", "/api/requests"],
      ["GET", "/api/requests/:id/curl"],
      ["GET", "/api/routes"],
      ["GET", "/api/logs"],
      ["GET", "/panels/:id/:name"],
      ["DELETE", "/api/account/sessions/:id"],
      ["POST", "/api/account/password"],
    ] as const) {
      expect(find(method, url)?.access, `${method} ${url}`).toEqual({ type: "viewer" });
    }
  });

  it("keeps administration, clearing requests and EXPLAIN for admins, with their audit types", () => {
    for (const [method, url] of [
      ["GET", "/api/admin/users"],
      ["GET", "/api/admin/audit"],
      ["POST", "/api/admin/invites"],
      ["DELETE", "/api/admin/invites/:id"],
      ["PATCH", "/api/admin/users/:id"],
      ["DELETE", "/api/admin/users/:id"],
      ["POST", "/api/admin/users/:id/reset-mfa"],
      ["POST", "/api/admin/users/:id/sign-out"],
      ["POST", "/api/admin/disable"],
    ] as const) {
      expect(find(method, url)?.access, `${method} ${url}`).toEqual({ type: "admin" });
    }

    expect(find("DELETE", "/api/requests")).toMatchObject({
      access: { type: "admin" },
      audit: "requests.cleared",
    });
    expect(find("POST", "/api/queries/:shapeId/explain")).toMatchObject({
      access: { type: "admin" },
      audit: "explain.run",
    });
  });

  it("adds a package panel: GET for viewers, every other method for admins with an audit entry", () => {
    expect(find("GET", "/api/grimoire")?.access).toEqual({ type: "viewer" });
    expect(find("GET", "/api/grimoire/*")?.access).toEqual({ type: "viewer" });

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(find(method, "/api/grimoire")).toMatchObject({
        access: { type: "admin" },
        audit: "panel.action",
      });
      expect(find(method, "/api/grimoire/*")).toMatchObject({
        access: { type: "admin" },
        audit: "panel.action",
      });
    }

    expect(productionRouteAccess([]).some((rule) => rule.url.includes("grimoire"))).toBe(false);
  });
});

describe("createAccessLookup", () => {
  const lookup = createAccessLookup(productionRouteAccess(["grimoire", "grim"]));

  it("finds exact patterns, treats HEAD as GET and returns nothing for unknown routes", () => {
    expect(lookup("GET", "/api/panels")?.access.type).toBe("viewer");
    expect(lookup("HEAD", "/api/panels")?.access.type).toBe("viewer");
    expect(lookup("POST", "/api/panels")).toBeUndefined();
    expect(lookup("GET", "/api/never-heard-of-it")).toBeUndefined();
  });

  it("matches a panel by its own prefix only", () => {
    expect(lookup("GET", "/api/grimoire/features/:feature")?.access.type).toBe("viewer");
    expect(lookup("POST", "/api/grimoire/features/:feature")?.access.type).toBe("admin");
    expect(lookup("GET", "/api/grimoirex/a")).toBeUndefined();
    expect(lookup("GET", "/api/grim/a")?.url).toBe("/api/grim/*");
  });
});

describe("AI report routes in production", () => {
  const rules = productionRouteAccess([]);
  const roleOf = (method: string, url: string) =>
    rules.find((rule) => rule.method === method && rule.url === url)?.access.type;

  it("lets viewers read the report routes and keeps evaluate to admins", () => {
    for (const url of [
      "/api/ai/reports",
      "/api/ai/models",
      "/api/ai/errors",
      "/api/ai/runs",
      "/api/ai/evaluate",
    ]) {
      expect(roleOf("GET", url)).toBe("viewer");
    }

    expect(roleOf("POST", "/api/ai/evaluate")).toBe("admin");
  });

  it("answers the uniform 404 for POST evaluate and for a report tab that is off", async () => {
    const on = await createApp({ builtInPanels: ["ai-reports"] });
    const session = await on.signIn("viewer-ai@example.com", "viewer");

    expect((await on.send("GET", "/api/ai/reports", { session })).statusCode).toBe(200);
    expect((await on.send("GET", "/api/ai/models", { session })).statusCode).toBe(404);

    const admin = await on.signIn("admin-ai@example.com", "admin");

    expect(
      (await on.send("POST", "/api/ai/evaluate", { session: admin, body: { systemPrompt: "x" } }))
        .statusCode,
    ).toBe(404);
  });
});

describe("the access table at the gate", () => {
  const rules = productionRouteAccess(["test-panel"]).filter(
    (rule) =>
      !rule.url.endsWith("/*") &&
      rule.url !== "/api/test-panel" &&
      rule.url !== "/api/stream" &&
      // Evaluate spends a model call: its POST is never registered in production (the rule stays as a fail-safe).
      !(rule.method === "POST" && rule.url === "/api/ai/evaluate"),
  );
  const destructive = (rule: DevtoolsRouteAccessRule) =>
    rule.url.includes("logout") || rule.url.includes("/sessions");

  it("applies each rule to anonymous visitors, unfinished sign-ins, viewers and admins", async () => {
    const t = await createApp({ builtInPanels: ALL_TABS, panels: [testPanel()] });
    let sessions = await sessionSet(t);
    const failures: string[] = [];

    for (const rule of rules) {
      for (const cell of [
        "anonymous",
        "password-change",
        "mfa-verify",
        "viewer",
        "admin",
      ] as const) {
        const response = await t.send(rule.method, concrete(rule.url), {
          session: sessions[cell],
          ...(rule.method === "GET" ? {} : { body: {} }),
        });
        const got = classify(response);

        if (got !== expected(rule, cell)) {
          failures.push(
            `${cell} ${rule.method} ${rule.url}: expected ${expected(rule, cell)}, got ${got} (${response.statusCode} ${response.body.slice(0, 80)})`,
          );
        }
      }

      // These routes end the sessions they are called with.
      if (destructive(rule)) sessions = await sessionSet(t);
    }

    expect(failures).toEqual([]);
  });

  it("answers a viewer on an admin route with 403 role.forbidden and its message", async () => {
    const t = await createApp();
    const viewer = await t.signIn("viewer@example.com");
    const response = await t.send("GET", "/api/admin/users", { session: viewer });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "Only admins can do this. Ask an admin.",
      code: "role.forbidden",
    });
  });

  it("treats a route with no entry in the table as admin-only", async () => {
    const t = await createApp();
    const viewer = await t.signIn("viewer@example.com");
    const admin = await t.signIn("admin@example.com", "admin");
    const anonymous = await t.send("GET", "/api/unlisted");

    expect(anonymous.statusCode).toBe(404);
    expect((await t.send("GET", "/api/unlisted", { session: viewer })).statusCode).toBe(403);
    expect((await t.send("GET", "/api/unlisted", { session: admin })).json()).toEqual({
      unlisted: true,
    });
  });

  it("lets a viewer read and an admin write package panel routes", async () => {
    const t = await createApp({ panels: [testPanel()] });
    const viewer = await t.signIn("viewer@example.com");
    const admin = await t.signIn("admin@example.com", "admin");

    expect(
      (await t.send("GET", "/api/test-panel/search?q=a", { session: viewer })).statusCode,
    ).toBe(200);
    expect(
      (await t.send("POST", "/api/test-panel/items", { session: viewer, body: { a: 1 } })).json(),
    ).toMatchObject({ code: "role.forbidden" });
    expect(
      (await t.send("POST", "/api/test-panel/items", { session: admin, body: { a: 1 } })).json(),
    ).toEqual({ received: { a: 1 } });
  });
});

describe("the share rules", () => {
  const find = (method: string, url: string) =>
    productionRouteAccess([], { share: true }).find(
      (rule) => rule.method === method && rule.url === url,
    );

  it("exist only when sharing is on", () => {
    expect(productionRouteAccess([]).some((rule) => rule.url.includes("share"))).toBe(false);
    expect(
      productionRouteAccess([], { share: false }).some((rule) => rule.url.includes("share")),
    ).toBe(false);
  });

  it("keeps the grant exchange public, the shared view behind the grant, and the management admin only", () => {
    expect(find("POST", "/api/share/open")?.access).toEqual({ type: "public" });

    for (const url of [
      "/api/share/info",
      "/api/share/view.js",
      "/api/share/assets/:name",
      "/api/share/files/*",
      "/api/share/panel",
      "/api/share/panel/*",
    ]) {
      expect(find("GET", url)?.access, url).toEqual({ type: "share" });
    }

    expect(find("GET", "/api/admin/shares")?.access).toEqual({ type: "admin" });
    expect(find("POST", "/api/admin/shares")?.access).toEqual({ type: "admin" });
    expect(find("DELETE", "/api/admin/shares/:id")?.access).toEqual({ type: "admin" });
    expect(find("POST", "/api/admin/shares/revoke-all")?.access).toEqual({ type: "admin" });
  });

  it("lets signed-in viewers read a panel's images", () => {
    expect(find("GET", "/panels/:id/files/*")?.access).toEqual({ type: "viewer" });
  });
});
