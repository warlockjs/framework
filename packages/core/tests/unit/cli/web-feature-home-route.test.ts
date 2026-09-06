import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveHomeRouteCollision } from "../../../src/generations/features/shared/relocate-conflicting-home-route";

/**
 * `warlock add web` 500'd on `GET /` on every freshly scaffolded app, because
 * the collision guard trusted one hardcoded path — `src/app/shared/routes.ts` —
 * that `create-warlock` never generates. The real template registers `GET /`
 * at `src/app/home/routes.ts`, so the guard's `fileExistsAsync` check always
 * failed, and every install silently reported "absent" while the page and the
 * template both claimed `/`.
 *
 * These assertions run against the REAL scaffold template, not a synthetic
 * fixture, because the defect was a property of that exact layout. A fixture
 * written to match today's template would keep passing the day the template's
 * routes move again.
 */
const TEMPLATE_APP_DIR = path.resolve(
  __dirname,
  "../../../../create-warlock/templates/warlock/src/app",
);

describe("scanning src/app/**/routes.{ts,tsx} for a home-route collision", () => {
  it("proves the premise: the real template claims GET \"/\" in app/home/routes.ts, not app/shared/routes.ts", () => {
    const homeRoutes = readFileSync(path.join(TEMPLATE_APP_DIR, "home/routes.ts"), "utf8");

    expect(homeRoutes).toMatch(/^router\s*\.\s*get\(\s*["'`]\/["'`]/m);
    expect(existsSync(path.join(TEMPLATE_APP_DIR, "shared/routes.ts"))).toBe(false);
  });

  it("relocates the real template's home route to /welcome and drops the top-level GET \"/\"", () => {
    const files = [
      {
        relativePath: "app/home/routes.ts",
        source: readFileSync(path.join(TEMPLATE_APP_DIR, "home/routes.ts"), "utf8"),
      },
    ];

    const { collision, rewrites } = resolveHomeRouteCollision(files);

    expect(collision).toEqual({ outcome: "relocated", relativePath: "app/home/routes.ts" });
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].source).toMatch(/^router\s*\.\s*get\(\s*["'`]\/welcome["'`]/m);
    expect(rewrites[0].source).not.toMatch(/^router\s*\.\s*get\(\s*["'`]\/["'`]/m);
  });

  it("does not treat a route nested inside router.group as a homepage collision", () => {
    const source = [
      'router.group({ prefix: "/notifications" }, () => {',
      '  router.get("/", listNotificationsController);',
      "});",
      "",
    ].join("\n");

    const { collision, rewrites } = resolveHomeRouteCollision([
      { relativePath: "app/notifications/routes.ts", source },
    ]);

    expect(collision).toEqual({ outcome: "absent" });
    expect(rewrites).toHaveLength(0);
  });

  it("reports a conflict, and rewrites nothing, when two files each declare a top-level GET \"/\"", () => {
    const files = [
      { relativePath: "app/home/routes.ts", source: 'router.get("/", homePageController);\n' },
      { relativePath: "app/shared/routes.ts", source: 'router.get("/", sharedController);\n' },
    ];

    const { collision, rewrites } = resolveHomeRouteCollision(files);

    expect(collision.outcome).toBe("conflict");
    expect(rewrites).toHaveLength(0);
  });

  it("reports a conflict rather than relocating onto an already-occupied /welcome", () => {
    const source = [
      'router.get("/", homePageController);',
      'router.get("/welcome", welcomeController);',
      "",
    ].join("\n");

    const { collision, rewrites } = resolveHomeRouteCollision([
      { relativePath: "app/home/routes.ts", source },
    ]);

    expect(collision.outcome).toBe("conflict");
    expect(rewrites).toHaveLength(0);
  });

  it("reports absent when nothing under src/app declares a top-level GET \"/\"", () => {
    const files = [
      { relativePath: "app/users/routes.ts", source: 'router.get("/list", listUsersController);\n' },
    ];

    const { collision, rewrites } = resolveHomeRouteCollision(files);

    expect(collision).toEqual({ outcome: "absent" });
    expect(rewrites).toHaveLength(0);
  });
});
