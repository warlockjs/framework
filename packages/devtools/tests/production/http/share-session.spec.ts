import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { checkDevtoolsPanels } from "../../../src/panels";
import { createShareSessions, SHARE_CACHE_MS } from "../../../src/production/http/share-session";
import { matchSharePath } from "../../../src/production/http/share";
import { createMemoryStore } from "../../../src/production/store/memory-store";

const view = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "test-panel",
  "view.js",
);
const hmac = (value: string) => createHash("sha256").update(`key:${value}`).digest("hex");

function world() {
  let at = 1_000_000;
  const store = createMemoryStore();
  const panels = checkDevtoolsPanels([
    { id: "book", title: "Book", view, share: { view, routes: [] } },
    { id: "plain", title: "Plain", view },
  ]);
  const sessions = createShareSessions({ store, panels, hmac, now: () => at });

  return { store, sessions, advance: (ms: number) => (at += ms), now: () => at };
}

async function link(w: ReturnType<typeof world>, panel = "book", expiresIn = 3_600_000) {
  return w.store.shares.create({
    tokenHash: createHash("sha256").update(`t-${Math.random()}`).digest("hex"),
    panel,
    label: "x",
    createdBy: null,
    createdAt: w.now(),
    expiresAt: w.now() + expiresIn,
  });
}

describe("share sessions", () => {
  it("issues a cookie that names the link and verifies it", async () => {
    const w = world();
    const share = await link(w);
    const { value, maxAgeSeconds } = w.sessions.issue(share);

    expect(value.startsWith(`${share.id}.`)).toBe(true);
    expect(maxAgeSeconds).toBe(3600);

    const result = await w.sessions.verify(value);

    expect("grant" in result && result.grant.panel.id).toBe("book");
  });

  it("limits the cookie to 12 hours", async () => {
    const w = world();
    const share = await link(w, "book", 30 * 86_400_000);

    expect(w.sessions.issue(share).maxAgeSeconds).toBe(12 * 3600);
  });

  it.each([
    ["undefined", undefined],
    ["an empty value", ""],
    ["two parts", "a.1"],
    ["four parts", "a.1.b.c"],
    ["a non-numeric expiry", "a.x.b"],
  ])("refuses %s as a bad cookie", async (_name, value) => {
    expect(await world().sessions.verify(value)).toEqual({ refused: "cookie", shareId: null });
  });

  it("refuses a changed expiry, a changed id and a wrong signature", async () => {
    const w = world();
    const share = await link(w);
    const [id = "", exp = "", sig = ""] = w.sessions.issue(share).value.split(".");

    for (const value of [
      `${id}.${Number(exp) + 1}.${sig}`,
      `other.${exp}.${sig}`,
      `${id}.${exp}.${sig.replace(/.$/, "0")}`,
    ]) {
      expect(await w.sessions.verify(value)).toEqual({ refused: "cookie", shareId: null });
    }
  });

  it("refuses an expired cookie", async () => {
    const w = world();
    const { value } = w.sessions.issue(await link(w));

    w.advance(3_600_001);

    expect(await w.sessions.verify(value)).toEqual({ refused: "cookie", shareId: null });
  });

  it("reads a revoke after the cache window, and refuses an unknown or panel-less link", async () => {
    const w = world();
    const share = await link(w);
    const { value } = w.sessions.issue(share);

    expect("grant" in (await w.sessions.verify(value))).toBe(true);
    await w.store.shares.revoke(share.id, w.now());
    expect("grant" in (await w.sessions.verify(value))).toBe(true);
    w.advance(SHARE_CACHE_MS + 1);
    expect(await w.sessions.verify(value)).toEqual({ refused: "revoked", shareId: share.id });

    const plain = await link(w, "plain");

    expect(await w.sessions.verify(w.sessions.issue(plain).value)).toEqual({
      refused: "panel",
      shareId: plain.id,
    });

    const gone = await link(w);
    const goneValue = w.sessions.issue(gone).value;

    await w.store.shares.revokeAll(w.now());
    await w.store.shares.removeOld(w.now() + 10);
    w.sessions.invalidate();
    // Removed entirely after the expiry the cookie still carries.
    expect(await w.sessions.verify(goneValue)).toEqual({ refused: "unknown", shareId: gone.id });
  });

  it("invalidate() drops the cache at once", async () => {
    const w = world();
    const share = await link(w);
    const { value } = w.sessions.issue(share);

    await w.sessions.verify(value);
    await w.store.shares.revoke(share.id, w.now());
    w.sessions.invalidate();

    expect(await w.sessions.verify(value)).toMatchObject({ refused: "revoked" });
  });

  it("opens by token hash and tells expired and revoked links apart", async () => {
    const w = world();
    const share = await link(w, "book", 1000);

    expect("grant" in (await w.sessions.open(share.tokenHash))).toBe(true);
    expect(await w.sessions.open("nope")).toEqual({ refused: "unknown", shareId: null });
    w.advance(1001);
    expect(await w.sessions.open(share.tokenHash)).toEqual({
      refused: "expired",
      shareId: share.id,
    });
  });

  it("records a use at most once a minute per link", async () => {
    const w = world();
    const share = await link(w);
    const touch = vi.spyOn(w.store.shares, "touch");

    w.sessions.touch(share.id);
    w.sessions.touch(share.id);
    w.advance(59_000);
    w.sessions.touch(share.id);
    expect(touch).toHaveBeenCalledTimes(1);
    w.advance(2000);
    w.sessions.touch(share.id);
    expect(touch).toHaveBeenCalledTimes(2);
  });
});

describe("matchSharePath", () => {
  it("matches literals and captures named segments", () => {
    expect(matchSharePath("/product", "/product")).toEqual({});
    expect(matchSharePath("/flows/:feature/:flow", "/flows/a/b")).toEqual({
      feature: "a",
      flow: "b",
    });
    expect(matchSharePath("", "")).toEqual({});
  });

  it.each([
    ["/product", "/other"],
    ["/product", "/product/extra"],
    ["/product/:id", "/product"],
    ["/product/:id", "/product/"],
    ["/product/:id", "/product/a/b"],
    ["/product/:id", "/product/a\\b"],
    ["/product/:id", "/product/a\0b"],
  ])("does not match %s against %s", (pattern, requested) => {
    expect(matchSharePath(pattern, requested)).toBeNull();
  });
});
