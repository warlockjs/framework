import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DevtoolsCreatedShare,
  DevtoolsShareList,
  DevtoolsShareOpenAnswer,
} from "../../../src/production/contracts";
import type { DevtoolsPanel } from "../../../src/types";
import { createApp, HOST, ORIGIN, PATH, type TestApp } from "./harness";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "test-panel",
);
const COOKIE = "__Secure-warlock-devtools-share";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "devtools-share-"));
  mkdirSync(path.join(root, "shots", "sub"), { recursive: true });
  writeFileSync(path.join(root, "shots", "a.png"), PNG);
  writeFileSync(path.join(root, "shots", "sub", "b.png"), PNG);
  writeFileSync(path.join(root, "shots", "vector.svg"), "<svg onload='x()'/>");
  writeFileSync(path.join(root, "shots", "notes.txt"), "text");
  writeFileSync(path.join(root, "outside.png"), PNG);
  writeFileSync(path.join(root, "book.css"), "body{}");
  writeFileSync(path.join(root, "secret.js"), "export const secret = 1;");
  symlinkSync(path.join(root, "outside.png"), path.join(root, "shots", "link.png"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

afterEach(() => vi.useRealTimers());

function bookPanel(): DevtoolsPanel {
  return {
    id: "book",
    title: "Book",
    view: path.join(fixtures, "view.js"),
    production: true,
    assets: { "book.css": path.join(root, "book.css"), "secret.js": path.join(root, "secret.js") },
    files: { dir: path.join(root, "shots") },
    routes: [
      { path: "/product", handler: ({ shared }) => ({ shared: shared === true }) },
      {
        path: "/product/:id",
        handler: ({ params, query, shared }) => ({ id: params.id, query, shared: shared === true }),
      },
      { path: "/private", handler: () => ({ private: true }) },
      { method: "POST", path: "/product", handler: () => ({ changed: true }) },
    ],
    share: {
      view: path.join(fixtures, "view.js"),
      routes: ["/product", "/product/:id"],
      assets: ["book.css"],
      files: true,
    },
  };
}

function otherPanel(): DevtoolsPanel {
  return {
    id: "other",
    title: "Other",
    view: path.join(fixtures, "view.js"),
    production: true,
    routes: [{ path: "/x", handler: () => ({ other: true }) }],
    share: { view: path.join(fixtures, "view.js"), routes: ["/x"] },
  };
}

async function setup(extra: Parameters<typeof createApp>[0] = {}) {
  const t = await createApp({
    production: { share: { enabled: true } },
    panels: [bookPanel(), otherPanel()],
    notFound: "custom",
    ...extra,
  });
  const admin = await t.signIn("admin@example.com", "admin");

  return { t, admin };
}

async function createLink(
  t: TestApp,
  admin: Awaited<ReturnType<TestApp["signIn"]>>,
  body: Record<string, unknown> = { panel: "book", label: "Review", days: 7 },
) {
  const response = await t.send("POST", "/api/admin/shares", { session: admin, body });

  expect(response.statusCode).toBe(201);

  const created = response.json<DevtoolsCreatedShare>();
  const token = created.url.split("#/share/")[1] ?? "";

  return { created, token };
}

function shareCookie(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header === undefined ? [] : [header];
  const found = cookies.find((cookie) => cookie.startsWith(`${COOKIE}=`));

  return found === undefined ? "" : (found.split(";")[0] ?? "");
}

const open = (t: TestApp, token: string, headers: Record<string, string> = {}) =>
  t.send("POST", "/api/share/open", { body: { token }, headers });

async function granted(t: TestApp, token: string): Promise<string> {
  const response = await open(t, token);

  expect(response.statusCode).toBe(200);

  return shareCookie(response);
}

const asShared = (t: TestApp, route: string, cookie: string) =>
  t.send("GET", route, { headers: { cookie } });

const failuresOf = async (t: TestApp) =>
  (await t.store.audit.list({ types: ["share.failed"], limit: 100 })).length;

async function appNotFound(t: TestApp): Promise<LightMyRequestResponse> {
  return t.inject({ method: "GET", url: "/random-unknown-url" });
}

describe("share links: sharing off", () => {
  it("mounts no share route and no admin share route", async () => {
    const t = await createApp({ panels: [bookPanel()], notFound: "custom" });
    const admin = await t.signIn("admin@example.com", "admin");
    const reference = await appNotFound(t);

    for (const response of [
      await t.send("POST", "/api/share/open", { body: { token: "x" } }),
      await t.send("GET", "/api/share/info"),
      await t.send("GET", "/api/admin/shares", { session: admin }),
      await t.send("POST", "/api/admin/shares", {
        session: admin,
        body: { panel: "book", label: "x", days: 1 },
      }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(reference.body);
    }
  });
});

describe("share links: creating and listing", () => {
  it("returns the URL once, with the token in the fragment, and stores only its hash", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin);

    expect(created.url).toBe(`${ORIGIN}${PATH}/#/share/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.share).toMatchObject({
      panel: "book",
      label: "Review",
      createdBy: "admin@example.com",
      status: "active",
      uses: 0,
    });
    expect(created.share.expiresAt - created.share.createdAt).toBe(7 * 86_400_000);

    const stored = await t.store.shares.list();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);

    const list = (
      await t.send("GET", "/api/admin/shares", { session: admin })
    ).json<DevtoolsShareList>();

    expect(list).toMatchObject({
      enabled: true,
      maxDays: 30,
      panels: [
        { id: "book", title: "Book" },
        { id: "other", title: "Other" },
      ],
    });
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(list)).not.toContain(stored[0]?.tokenHash ?? "never");
  });

  it("audits creation and revoking without the token", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin);

    expect(
      (await t.send("DELETE", `/api/admin/shares/${created.share.id}`, { session: admin }))
        .statusCode,
    ).toBe(204);

    const audit = await t.store.audit.list({
      types: ["share.created", "share.revoked"],
      limit: 10,
    });

    expect(audit.map((entry) => entry.type).sort()).toEqual(["share.created", "share.revoked"]);
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(t.warnings.join("\n")).not.toContain(token);
  });

  it("refuses viewers, unknown panels, bad labels and bad lifetimes", async () => {
    const { t, admin } = await setup();
    const viewer = await t.signIn("viewer@example.com", "viewer");

    expect(
      (
        await t.send("POST", "/api/admin/shares", {
          session: viewer,
          body: { panel: "book", label: "x", days: 1 },
        })
      ).json<{ code: string }>().code,
    ).toBe("role.forbidden");
    expect((await t.send("GET", "/api/admin/shares", { session: viewer })).statusCode).toBe(403);

    for (const body of [
      { panel: "nope", label: "x", days: 1 },
      { panel: "test-panel", label: "x", days: 1 },
      { panel: "book", label: "", days: 1 },
      { panel: "book", label: "   ", days: 1 },
      { panel: "book", label: "x".repeat(81), days: 1 },
      { panel: "book", label: "bad\nlabel", days: 1 },
      { panel: "book", label: "x", days: 0 },
      { panel: "book", label: "x", days: 31 },
      { panel: "book", label: "x", days: 1.5 },
      { panel: "book", label: "x", days: "3" },
    ]) {
      const response = await t.send("POST", "/api/admin/shares", { session: admin, body });

      expect(response.statusCode, JSON.stringify(body)).toBe(422);
      expect(response.json<{ code: string }>().code).toBe("input.invalid");
    }

    expect(await t.store.shares.list()).toEqual([]);
  });

  it("allows a longer life up to production.share.maxDays", async () => {
    const { t, admin } = await setup({ production: { share: { enabled: true, maxDays: 90 } } });

    await createLink(t, admin, { panel: "book", label: "Quarter", days: 90 });
    expect((await t.store.shares.list())[0]?.expiresAt).toBeGreaterThan(
      Date.now() + 89 * 86_400_000,
    );
  });

  it("revokes one link, answers share.not-found for an unknown or repeated revoke, and revokes all", async () => {
    const { t, admin } = await setup();
    const first = await createLink(t, admin);

    await createLink(t, admin, { panel: "other", label: "Second", days: 1 });

    const gone = await t.send("DELETE", "/api/admin/shares/missing", { session: admin });

    expect(gone.statusCode).toBe(404);
    expect(gone.json<{ code: string }>().code).toBe("share.not-found");

    await t.send("DELETE", `/api/admin/shares/${first.created.share.id}`, { session: admin });

    expect(
      (
        await t.send("DELETE", `/api/admin/shares/${first.created.share.id}`, { session: admin })
      ).json<{ code: string }>().code,
    ).toBe("share.not-found");

    const all = await t.send("POST", "/api/admin/shares/revoke-all", { session: admin, body: {} });

    expect(all.json()).toEqual({ revoked: 1 });
    expect((await t.store.shares.list()).every((share) => share.revokedAt !== null)).toBe(true);
  });
});

describe("share links: opening", () => {
  it("exchanges the token for a scoped cookie and answers what the link opens", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);
    const response = await open(t, token);
    const header = String(response.headers["set-cookie"]);

    expect(response.statusCode).toBe(200);
    expect(response.json<DevtoolsShareOpenAnswer>()).toMatchObject({
      panel: "book",
      title: "Book",
      label: "Review",
      assets: ["book.css"],
      files: true,
    });
    expect(header).toContain(`${COOKIE}=`);
    expect(header).toContain(`Path=${PATH}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toMatch(/Domain=/i);
    expect(header).not.toContain(token);
    // A 7-day link: the cookie lives 12 hours.
    expect(header).toContain(`Max-Age=${12 * 3600}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("ends the cookie with a short link", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin, { panel: "book", label: "Day", days: 1 });
    const response = await open(t, token);
    const age = Number(/Max-Age=(\d+)/.exec(String(response.headers["set-cookie"]))?.[1]);

    expect(age).toBeLessThanOrEqual(12 * 3600);
    expect(age).toBeLessThanOrEqual(Math.ceil((created.share.expiresAt - Date.now()) / 1000));
  });

  it("counts the use", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin);

    await open(t, token);
    await vi.waitFor(async () =>
      expect(await t.store.shares.get(created.share.id)).toMatchObject({ uses: 1 }),
    );
    expect((await t.store.shares.get(created.share.id))?.lastUsedAt).not.toBeNull();
  });

  it.each([
    ["an unknown token", async () => "A".repeat(43)],
    ["an empty token", async () => ""],
  ])("answers the uniform 404 and audits one share.failed for %s", async (_name, pick) => {
    const { t } = await setup();
    const reference = await appNotFound(t);
    const response = await open(t, await pick());

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(reference.body);
    expect(response.headers["set-cookie"]).toBeUndefined();

    // An empty token is refused before any lookup; a wrong one is audited once.
    expect(await failuresOf(t)).toBe(_name === "an unknown token" ? 1 : 0);
  });

  it("answers the uniform 404 for an expired link and a revoked link, auditing each", async () => {
    const { t, admin } = await setup();
    const expired = await createLink(t, admin, { panel: "book", label: "Short", days: 1 });
    const revoked = await createLink(t, admin);

    await t.send("DELETE", `/api/admin/shares/${revoked.created.share.id}`, { session: admin });

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 86_400_000 });

    const reference = await appNotFound(t);

    for (const { token } of [expired, revoked]) {
      const response = await open(t, token);

      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(reference.body);
    }

    const entries = await t.store.audit.list({ types: ["share.failed"], limit: 10 });

    expect(entries.map((entry) => entry.detail.reason).sort()).toEqual(["expired", "revoked"]);
    expect(JSON.stringify(entries)).not.toContain(expired.token);
    expect(JSON.stringify(entries)).not.toContain(revoked.token);
  });

  it("refuses a body that is not JSON or not an object with the uniform 404", async () => {
    const { t } = await setup();
    const reference = await appNotFound(t);

    for (const response of [
      await t.inject({
        method: "POST",
        url: `${PATH}/api/share/open`,
        payload: "token=abc",
        headers: { origin: ORIGIN, "content-type": "text/plain" },
      }),
      await t.inject({
        method: "POST",
        url: `${PATH}/api/share/open`,
        payload: "{not json",
        headers: { origin: ORIGIN, "content-type": "application/json" },
      }),
      await t.send("POST", "/api/share/open", { body: [] }),
      await t.send("POST", "/api/share/open", { body: { token: 5 } }),
      await t.send("POST", "/api/share/open", { body: { token: "x".repeat(600) } }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(reference.body);
    }
  });

  it("needs the expected origin", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);
    const reference = await appNotFound(t);

    for (const headers of [
      { origin: "https://evil.example.com" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site", origin: ORIGIN },
    ]) {
      const response = await t.inject({
        method: "POST",
        url: `${PATH}/api/share/open`,
        payload: { token },
        headers,
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(reference.body);
    }

    const noOrigin = await t.inject({
      method: "POST",
      url: `${PATH}/api/share/open`,
      payload: { token },
    });

    expect(noOrigin.statusCode).toBe(404);
  });

  it("keeps the HTTPS and allowed-IP gates", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);

    expect((await open(t, token, { "x-forwarded-proto": "http" })).statusCode).toBe(404);

    const guarded = {
      t: await createApp({
        production: { share: { enabled: true }, allowedIps: ["198.51.100.0/24"] },
        panels: [bookPanel()],
      }),
    };
    const link = await guarded.t.store.shares.create({
      tokenHash: createHash("sha256").update("known-token").digest("hex"),
      panel: "book",
      label: "x",
      createdBy: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    expect(link.id).toBeTruthy();
    expect((await open(guarded.t, "known-token")).statusCode).toBe(404);
    expect(
      (await open(guarded.t, "known-token", { "x-forwarded-for": "198.51.100.9" })).statusCode,
    ).toBe(200);
  });

  it("stops answering a client that fails too often, even with a valid token", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);

    for (let attempt = 0; attempt < 20; attempt++) await open(t, `wrong-${attempt}`);

    expect(await failuresOf(t)).toBe(20);
    expect((await open(t, token)).statusCode).toBe(404);
    // Over the limit: no further audit rows.
    expect(await failuresOf(t)).toBe(20);
    // Another client is not affected.
    expect((await open(t, token, { "x-forwarded-for": "203.0.113.77" })).statusCode).toBe(200);
  });
});

describe("share links: what a grant reaches", () => {
  it("serves the shared view, the listed assets, the info and the listed GET routes", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);
    const cookie = await granted(t, token);

    const info = await asShared(t, "/api/share/info", cookie);

    expect(info.json<DevtoolsShareOpenAnswer>().panel).toBe("book");

    const view = await asShared(t, "/api/share/view.js", cookie);

    expect(view.statusCode).toBe(200);
    expect(view.headers["content-type"]).toContain("text/javascript");
    expect(view.headers["x-content-type-options"]).toBe("nosniff");
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.body).toContain("renderTestPanel");

    const css = await asShared(t, "/api/share/assets/book.css", cookie);

    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");

    const product = await asShared(t, "/api/share/panel/product", cookie);

    expect(product.json()).toEqual({ shared: true });
    expect(product.headers["cache-control"]).toBe("no-store");
    expect(product.headers["x-robots-tag"]).toContain("noindex");
    expect((await asShared(t, "/api/share/panel/product/42?x=1", cookie)).json()).toEqual({
      id: "42",
      query: { x: "1" },
      shared: true,
    });
  });

  it("refuses assets, routes and methods the panel did not list", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const reference = await appNotFound(t);

    for (const route of [
      "/api/share/assets/secret.js",
      "/api/share/assets/nope.css",
      "/api/share/assets/__proto__",
      "/api/share/panel/private",
      "/api/share/panel/product/1/extra",
      "/api/share/panel/product%2F1%2F2",
      "/api/share/panel/%2e%2e/private",
      "/api/share/panel",
      "/api/share/panel/x",
    ]) {
      const response = await asShared(t, route, cookie);

      expect(response.statusCode, route).toBe(404);
      expect(response.body, route).toBe(reference.body);
    }

    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const response = await t.send(method, "/api/share/panel/product", {
        headers: { cookie },
        body: {},
      });

      expect(response.statusCode, method).toBe(404);
    }
  });

  it("keeps a link to one panel away from another panel", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const other = await granted(
      t,
      (await createLink(t, admin, { panel: "other", label: "Other", days: 1 })).token,
    );

    expect((await asShared(t, "/api/share/panel/x", cookie)).statusCode).toBe(404);
    expect((await asShared(t, "/api/share/panel/x", other)).json()).toEqual({ other: true });
    expect((await asShared(t, "/api/share/panel/product", other)).statusCode).toBe(404);
    // The panel's own routes are not reachable without a session.
    expect((await asShared(t, "/api/other/x", cookie)).statusCode).toBe(404);
    expect((await asShared(t, "/api/book/product", cookie)).statusCode).toBe(404);
  });

  it("never lets a share cookie reach a route outside the share routes", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const reference = await appNotFound(t);

    for (const route of [
      "/api/panels",
      "/api/account",
      "/api/requests",
      "/api/errors",
      "/api/admin/shares",
      "/api/admin/users",
      "/api/admin/audit",
      "/panels/book/view.js",
      "/panels/book/files/a.png",
      "/api/unlisted",
    ]) {
      const response = await asShared(t, route, cookie);

      expect(response.statusCode, route).toBe(404);
      expect(response.body, route).toBe(reference.body);
    }

    const session = await asShared(t, "/api/auth/session", cookie);

    expect(session.json()).toMatchObject({ stage: "signed-out", account: null });

    const post = await t.send("POST", "/api/admin/shares", {
      headers: { cookie },
      body: { panel: "book", label: "x", days: 1 },
    });

    expect(post.statusCode).toBe(404);
  });

  it("does not take a signed-in session for a grant", async () => {
    const { t, admin } = await setup();
    const response = await t.send("GET", "/api/share/info", { session: admin });

    expect(response.statusCode).toBe(404);
  });

  it("refuses a missing, tampered, truncated or foreign cookie", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const value = cookie.slice(COOKIE.length + 1);
    const [id = "", exp = "", sig = ""] = value.split(".");
    const forged = [
      "",
      `${COOKIE}=`,
      `${COOKIE}=${id}.${exp}`,
      `${COOKIE}=${id}.${Number(exp) + 1000}.${sig}`,
      `${COOKIE}=${id}.${exp}.${"0".repeat(sig.length)}`,
      `${COOKIE}=other-id.${exp}.${sig}`,
      `${COOKIE}=${value}.extra`,
      `${COOKIE}=garbage`,
    ];

    for (const header of forged) {
      const response = await asShared(t, "/api/share/info", header);

      expect(response.statusCode, header).toBe(404);
    }
  });

  it("refuses an expired cookie and an expired link", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 12 * 3600_000 + 1000 });

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(404);
  });

  it("takes effect within the cache window after a revoke made elsewhere", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin);
    const cookie = await granted(t, token);

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(200);

    // Another instance revokes: this one still holds the record it read a moment ago.
    await t.store.shares.revoke(created.share.id, Date.now());

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 5100 });

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(404);
  });

  it("takes effect at once on the instance that revoked", async () => {
    const { t, admin } = await setup();
    const { created, token } = await createLink(t, admin);
    const cookie = await granted(t, token);

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(200);

    await t.send("DELETE", `/api/admin/shares/${created.share.id}`, { session: admin });

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(404);

    const again = await granted(t, (await createLink(t, admin)).token);

    await t.send("POST", "/api/admin/shares/revoke-all", { session: admin, body: {} });

    expect((await asShared(t, "/api/share/info", again)).statusCode).toBe(404);
  });

  it("audits a refused cookie once a minute per client and never records the cookie", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const bad = `${COOKIE}=${cookie.slice(COOKIE.length + 1)}x`;

    await asShared(t, "/api/share/info", bad);
    await asShared(t, "/api/share/info", bad);

    expect(await failuresOf(t)).toBe(1);

    const entries = await t.store.audit.list({ types: ["share.failed"], limit: 10 });

    expect(JSON.stringify(entries)).not.toContain(cookie.slice(COOKIE.length + 1));
  });

  it("stops serving when the dashboard is disabled", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);

    await t.store.state.update(0, { lockedUntil: Date.now() + 60_000 });
    t.state.invalidate();

    expect((await asShared(t, "/api/share/info", cookie)).statusCode).toBe(404);
  });

  it("never writes the token to a log line", async () => {
    const { t, admin } = await setup();
    const { token } = await createLink(t, admin);

    await open(t, token);
    await open(t, `${token}-wrong`);

    expect(t.warnings.join("\n")).not.toContain(token);
  });
});

describe("share links: image folders", () => {
  it("serves listed images through the share route and through the signed-in route", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);

    for (const response of [
      await asShared(t, "/api/share/files/a.png", cookie),
      await asShared(t, "/api/share/files/sub/b.png", cookie),
      await t.send("GET", "/panels/book/files/a.png", { session: admin }),
    ]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.rawPayload.equals(PNG)).toBe(true);
    }
  });

  it.each([
    "%2e%2e%2foutside.png",
    "..%2foutside.png",
    "..%5coutside.png",
    "sub%5c..%5c..%5coutside.png",
    "%2Fetc%2Fpasswd",
    "/etc/passwd",
    "//a.png",
    "sub//b.png",
    "a.png%00.txt",
    "link.png",
    "vector.svg",
    "notes.txt",
    "missing.png",
    "sub",
    "sub/",
    "C:%5cwindows%5cwin.ini",
  ])("answers the uniform 404 for the path %s on both file routes", async (requested) => {
    const { t, admin } = await setup();
    const cookie = await granted(t, (await createLink(t, admin)).token);
    const reference = await appNotFound(t);
    const shared = await asShared(t, `/api/share/files/${requested}`, cookie);
    const signedIn = await t.send("GET", `/panels/book/files/${requested}`, { session: admin });

    for (const response of [shared, signedIn]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(reference.body);
    }
  });

  it("serves no shared image when the panel did not set share.files", async () => {
    const { t, admin } = await setup();
    const cookie = await granted(
      t,
      (await createLink(t, admin, { panel: "other", label: "No files", days: 1 })).token,
    );

    expect((await asShared(t, "/api/share/files/a.png", cookie)).statusCode).toBe(404);
  });

  it("answers the uniform 404 for a panel without a folder and for an unknown panel", async () => {
    const { t, admin } = await setup();

    expect((await t.send("GET", "/panels/other/files/a.png", { session: admin })).statusCode).toBe(
      404,
    );
    expect((await t.send("GET", "/panels/nope/files/a.png", { session: admin })).statusCode).toBe(
      404,
    );
    expect((await t.send("GET", "/panels/book/files/a.png")).statusCode).toBe(404);
  });
});

describe("share links: tabs", () => {
  it("marks the panels that can be shared in the tab list", async () => {
    const { t, admin } = await setup();
    const tabs = (await t.send("GET", "/api/panels", { session: admin })).json<
      { id: string; shareable: boolean }[]
    >();

    expect(tabs.find((tab) => tab.id === "book")?.shareable).toBe(true);
    expect(tabs.find((tab) => tab.id === "requests")?.shareable).toBe(false);
  });

  it("tells the session whether sharing is on", async () => {
    const { t, admin } = await setup();
    const off = await createApp({ panels: [bookPanel()] });
    const offAdmin = await off.signIn("admin@example.com", "admin");

    expect((await t.send("GET", "/api/auth/session", { session: admin })).json()).toMatchObject({
      share: { enabled: true },
    });
    expect(
      (await off.send("GET", "/api/auth/session", { session: offAdmin })).json(),
    ).toMatchObject({ share: { enabled: false } });
    expect((await t.send("GET", "/api/auth/session")).json()).toMatchObject({ share: null });
    expect(HOST).toBeTruthy();
  });
});
