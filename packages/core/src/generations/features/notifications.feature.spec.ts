import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let existing = new Set<string>();
let directories = new Set<string>();
let contents = new Map<string, string>();
let written = new Map<string, string>();

vi.mock("@warlock.js/fs", () => ({
  ensureDirectoryAsync: vi.fn(async () => undefined),
  directoryExistsAsync: vi.fn(async (path: string) => directories.has(normalize(path))),
  fileExistsAsync: vi.fn(async (path: string) => existing.has(normalize(path))),
  getFileAsync: vi.fn(async (path: string) => contents.get(normalize(path)) ?? ""),
  putFileAsync: vi.fn(async (path: string, content: string) => {
    written.set(normalize(path), content);
  }),
}));

/** Make a file exist in the mocked filesystem, with optional content. */
function givenFile(relativeToSrc: string, content = "") {
  const path = normalize(srcPath(relativeToSrc));

  existing.add(path);
  contents.set(path, content);
}

import { srcPath } from "../../utils";
import { notificationsFeature } from "./notifications.feature";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Written paths relative to src/app/notifications, with the migration timestamp masked. */
function writtenModuleFiles(): string[] {
  const moduleRoot = normalize(srcPath("app/notifications")) + "/";

  return [...written.keys()]
    .filter((path) => path.startsWith(moduleRoot))
    .map((path) =>
      path
        .slice(moduleRoot.length)
        .replace(/migrations\/[^/]+-notification/, "migrations/<timestamp>-notification"),
    )
    .sort();
}

describe("warlock add notifications", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    existing = new Set();
    directories = new Set();
    contents = new Map();
    written = new Map();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("writes a module laid out one responsibility per file, without specs when tests are not set up", async () => {
    await notificationsFeature.onExecuting?.({} as never);

    expect(writtenModuleFiles()).toEqual([
      "controllers/list-notifications.controller.ts",
      "controllers/mark-all-notifications-read.controller.ts",
      "controllers/mark-notification-read.controller.ts",
      "controllers/unread-notifications-count.controller.ts",
      "models/notification/migrations/<timestamp>-notification.migration.ts",
      "models/notification/notification.model.ts",
      "resources/notification.resource.ts",
      "routes.ts",
      "schema/list-notifications.schema.ts",
      "services/mark-notification-read.service.ts",
      "types/notifications-request.type.ts",
      "utils/locales.json",
    ]);
  });

  it("writes one spec per controller when the app has the test feature", async () => {
    existing.add(normalize(srcPath("test-setup.ts")));

    await notificationsFeature.onExecuting?.({} as never);

    const specs = writtenModuleFiles().filter((file) => file.endsWith(".spec.ts"));

    expect(specs).toEqual([
      "controllers/list-notifications.controller.spec.ts",
      "controllers/mark-all-notifications-read.controller.spec.ts",
      "controllers/mark-notification-read.controller.spec.ts",
      "controllers/unread-notifications-count.controller.spec.ts",
    ]);

    const listSpec = written.get(
      normalize(srcPath("app/notifications/controllers/list-notifications.controller.spec.ts")),
    );

    expect(listSpec).toContain('await testGet("/notifications")');
    expect(listSpec).toContain("expect(response.status).toBe(401)");
    expect(listSpec).toContain("lists only the signed-in recipient");
    expect(
      written.get(normalize(srcPath("app/notifications/tests/notifications.fixture.ts"))),
    ).toContain("actingAs(user)");
  });

  it("skips an app scaffolded by 5.29 or earlier, whose model sits at the module root", async () => {
    existing.add(normalize(srcPath("app/notifications/notification.model.ts")));

    await notificationsFeature.onExecuting?.({} as never);

    expect(writtenModuleFiles()).toEqual([]);
  });

  it("skips an app that already has the 5.30 layout", async () => {
    existing.add(normalize(srcPath("app/notifications/models/notification/notification.model.ts")));

    await notificationsFeature.onExecuting?.({} as never);

    expect(writtenModuleFiles()).toEqual([]);
  });

  it("generates only the four read endpoints, with no clear-all or delete route", async () => {
    await notificationsFeature.onExecuting?.({} as never);

    const routes = written.get(normalize(srcPath("app/notifications/routes.ts"))) ?? "";

    expect(routes).toContain('router.route("/notifications")');
    expect(routes).not.toMatch(/\.delete\(|\.destroy\(|\.deleteOne\(/);
  });

  it("validates the list query and never forwards request.all()", async () => {
    await notificationsFeature.onExecuting?.({} as never);

    const list = written.get(
      normalize(srcPath("app/notifications/controllers/list-notifications.controller.ts")),
    );
    const schema = written.get(
      normalize(srcPath("app/notifications/schema/list-notifications.schema.ts")),
    );

    expect(list).toContain("request.validated()");
    expect(list).not.toContain("request.all()");
    expect(schema).toContain("max(50)");
  });

  it("points the ejected config at the model's new path", async () => {
    expect(notificationsFeature.ejectConfig?.content).toContain(
      'from "app/notifications/models/notification/notification.model"',
    );
  });

  describe("an app that already has a notifications module", () => {
    beforeEach(() => {
      directories.add(normalize(srcPath("app/notifications")));
    });

    it("adds no second Notification model or migration, and never overwrites the app's files", async () => {
      givenFile("app/notifications/routes.ts", "// the app's own routes");
      givenFile(
        "app/notifications/controllers/list-notifications.controller.ts",
        "// the app's own list",
      );

      await notificationsFeature.onExecuting?.({} as never);

      const files = writtenModuleFiles();

      expect(files.some((file) => file.startsWith("models/"))).toBe(false);
      expect(files).not.toContain("routes.ts");
      expect(files).not.toContain("controllers/list-notifications.controller.ts");
      expect(files).toContain("controllers/mark-notification-read.controller.ts");
      expect(logSpy.mock.calls.flat().join("\n")).toContain("src/app/notifications/routes.ts");
    });

    it("merges notFound into an existing locales.json and keeps the app's keys", async () => {
      givenFile(
        "app/notifications/utils/locales.json",
        JSON.stringify({ notFound: { en: "Gone" }, digest: { en: "Daily digest" } }),
      );

      await notificationsFeature.onExecuting?.({} as never);

      expect(written.has(normalize(srcPath("app/notifications/utils/locales.json")))).toBe(false);

      givenFile(
        "app/notifications/utils/locales.json",
        JSON.stringify({ digest: { en: "Daily digest" } }),
      );
      written = new Map();

      await notificationsFeature.onExecuting?.({} as never);

      const merged = JSON.parse(
        written.get(normalize(srcPath("app/notifications/utils/locales.json"))) ?? "{}",
      );

      expect(merged).toEqual({
        digest: { en: "Daily digest" },
        notFound: { en: "Notification not found" },
      });
    });

    it("leaves a locales.json that renames its group for the app to update", async () => {
      givenFile("app/notifications/utils/locales.json", JSON.stringify({ $group: "alerts" }));

      await notificationsFeature.onExecuting?.({} as never);

      expect(written.has(normalize(srcPath("app/notifications/utils/locales.json")))).toBe(false);
    });
  });

  it("points a freshly ejected config at the 5.29 model when that is the model the app has", async () => {
    givenFile("app/notifications/notification.model.ts");
    givenFile("config/notifications.ts", notificationsFeature.ejectConfig?.content ?? "");

    await notificationsFeature.onExecuting?.({} as never);

    const config = written.get(normalize(srcPath("config/notifications.ts"))) ?? "";

    expect(config).toContain('from "app/notifications/notification.model"');
    expect(config).not.toContain("models/notification/notification.model");
  });

  it("leaves a config that already imports another model path alone", async () => {
    givenFile("app/notifications/notification.model.ts");
    givenFile(
      "config/notifications.ts",
      'import { Notification } from "app/alerts/alert.model";\n',
    );

    await notificationsFeature.onExecuting?.({} as never);

    expect(written.has(normalize(srcPath("config/notifications.ts")))).toBe(false);
  });

  it("coerces a numeric id before marking it read and strips unknown list query keys", async () => {
    await notificationsFeature.onExecuting?.({} as never);

    const markRead = written.get(
      normalize(srcPath("app/notifications/controllers/mark-notification-read.controller.ts")),
    );
    const schema = written.get(
      normalize(srcPath("app/notifications/schema/list-notifications.schema.ts")),
    );

    expect(markRead).toContain("/^\\d+$/.test(rawId) ? Number(rawId) : rawId");
    expect(schema).toContain(".stripUnknown()");
  });
});
