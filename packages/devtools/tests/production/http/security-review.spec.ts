import { describe, expect, it } from "vitest";
import { DASHBOARD_CSP } from "../../../src/production/http/headers";
import { createApp, PATH } from "./harness";

// The server as a real app builds it: core drops a trailing slash before
// routing and stamps its app-wide security headers on every response.
describe("the production mount on core's HTTP server", () => {
  it("serves the shell at <path>/ instead of redirecting it to itself", async () => {
    const t = await createApp({ coreServer: true });
    const shell = await t.inject({ method: "GET", url: `${PATH}/` });

    expect(shell.statusCode).toBe(200);
    expect(shell.body).toBe("<html>shell</html>");
  });

  it("still redirects the bare path to <path>/, keeping the query", async () => {
    const t = await createApp({ coreServer: true });
    const bare = await t.inject({ method: "GET", url: `${PATH}?x=1` });

    expect(bare.statusCode).toBe(308);
    expect(bare.headers.location).toBe(`${PATH}/?x=1`);
  });

  it("sends the dashboard's own CSP even when the app already set one", async () => {
    const t = await createApp({ coreServer: true });
    const shell = await t.inject({ method: "GET", url: `${PATH}/` });

    expect(shell.headers["content-security-policy"]).toBe(DASHBOARD_CSP);
    expect(shell.headers["x-frame-options"]).toBe("DENY");
    expect(shell.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("keeps the app's headers on the uniform 404", async () => {
    const t = await createApp({ coreServer: true });
    const closed = await t.inject({ method: "GET", url: `${PATH}/api/panels` });
    const unknown = await t.inject({ method: "GET", url: "/random-unknown-url" });

    expect(closed.statusCode).toBe(404);
    expect(closed.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(closed.headers["content-security-policy"]).toBe(
      unknown.headers["content-security-policy"],
    );
  });
});

describe("the dashboard path in the app's log", () => {
  it("is not written when a dashboard route fails", async () => {
    const t = await createApp({
      routes: {
        listRoutes: () => {
          throw new Error("router exploded");
        },
      },
    });
    const session = await t.signIn("viewer@example.com");
    const failed = await t.send("GET", "/api/routes", { session });

    expect(failed.statusCode).toBe(500);
    expect(t.warnings.some((line) => line.includes("router exploded"))).toBe(true);
    expect(t.warnings.some((line) => line.includes("/api/routes"))).toBe(true);
    expect(t.warnings.join("\n")).not.toContain(PATH);
  });
});
