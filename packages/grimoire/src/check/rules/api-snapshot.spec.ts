import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { snapshot } from "../../../tests/check/snapshot-builder";
import type { BookRoute } from "../../contracts";
import { routeLines } from "../../guard/api";
import { checkApiSnapshot } from "./api-snapshot";

const root = mkdtempSync(path.join(tmpdir(), "grimoire-api-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const route = (method: string, routePath: string, extra: Partial<BookRoute> = {}): BookRoute => ({
  method,
  path: routePath,
  name: null,
  sourceFile: null,
  handler: "anonymous",
  controller: null,
  action: null,
  handlerFile: null,
  middleware: [],
  auth: { required: false, userTypes: [] },
  isPage: false,
  description: null,
  ...extra,
});

function approve(lines: string[]): void {
  mkdirSync(path.join(root, "grimoire/approved"), { recursive: true });
  writeFileSync(
    path.join(root, "grimoire/approved/api.json"),
    JSON.stringify({ schemaVersion: 1, approvedAt: "2026-11-23T00:00:00.000Z", routes: lines }),
  );
}

describe("routeLines", () => {
  it("sorts, marks signed-in routes and leaves pages out", () => {
    expect(
      routeLines([
        route("post", "/orders", { auth: { required: true, userTypes: [] } }),
        route("GET", "/products"),
        route("GET", "/home", { isPage: true }),
        route("GET", "/products"),
      ]),
    ).toEqual(["GET /products", "POST /orders [auth]"]);
  });
});

describe("checkApiSnapshot", () => {
  it("reports nothing before the API is approved", () => {
    const target = snapshot({ root: path.join(root, "none") });

    target.book.facts.routes = [route("GET", "/a")];

    expect(checkApiSnapshot(target)).toEqual([]);
  });

  it("reports nothing while the routes were never collected", () => {
    approve(["GET /a"]);

    const target = snapshot({ root });

    target.book.facts.routes = null;

    expect(checkApiSnapshot(target)).toEqual([]);
  });

  it("GR7013 (a warning) names the routes added and removed", () => {
    approve(["GET /a", "GET /b"]);

    const target = snapshot({ root });

    target.book.facts.routes = [route("GET", "/b"), route("POST", "/c")];

    const [finding] = checkApiSnapshot(target);

    expect(finding?.code).toBe("GR7013");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("added POST /c; removed GET /a");
  });

  it("reports nothing when the routes match", () => {
    approve(["GET /a"]);

    const target = snapshot({ root });

    target.book.facts.routes = [route("GET", "/a")];

    expect(checkApiSnapshot(target)).toEqual([]);
  });
});
