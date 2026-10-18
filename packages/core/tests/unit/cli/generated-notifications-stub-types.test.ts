import path from "node:path";
import { compileSources } from "../../../src/tooling/typescript/compiler";
import { describe, expect, it } from "vitest";

import {
  listNotificationsControllerStub,
  listNotificationsSchemaStub,
  markAllNotificationsReadControllerStub,
  markNotificationReadControllerStub,
  markNotificationReadServiceStub,
  notificationResourceStub,
  notificationModelStub,
  notificationTestFixtureStub,
  notificationControllerSpecStub,
  notificationsRequestTypeStub,
  unreadNotificationsCountControllerStub,
} from "../../../src/generations/stubs";

/** Compile notification stubs against the actual workspace source using a native
 * compiler snapshot. The negative control reads authenticated user data through an
 * unguarded RequestHandler and must fail, while the generated guarded handlers pass.
 */

const CORE_DIR = path.resolve(__dirname, "../../..").split(path.sep).join("/");
const TSCONFIG_TYPECHECK_PATH = path.join(CORE_DIR, "tsconfig.typecheck.json");

/** Virtual (never written to disk) copy of the generated module, laid out as `warlock add` writes it. */
const MODULE_DIR = `${CORE_DIR}/__generated-notifications-stub-types-test__/notifications`;

const GENERATED_FILES: Record<string, string> = {
  [`${MODULE_DIR}/models/notification/notification.model.ts`]: notificationModelStub,
  [`${MODULE_DIR}/tests/notifications.fixture.ts`]: notificationTestFixtureStub,
  [`${MODULE_DIR}/controllers/list-notifications.controller.spec.ts`]:
    notificationControllerSpecStub("GET", "/notifications"),
  [`${MODULE_DIR}/controllers/unread-notifications-count.controller.spec.ts`]:
    notificationControllerSpecStub("GET", "/notifications/unread-count"),
  [`${MODULE_DIR}/controllers/mark-notification-read.controller.spec.ts`]:
    notificationControllerSpecStub("PATCH", "/notifications/1/read"),
  [`${MODULE_DIR}/controllers/mark-all-notifications-read.controller.spec.ts`]:
    notificationControllerSpecStub("PATCH", "/notifications/read-all"),
  [`${MODULE_DIR}/types/notifications-request.type.ts`]: notificationsRequestTypeStub,
  [`${MODULE_DIR}/schema/list-notifications.schema.ts`]: listNotificationsSchemaStub,
  [`${MODULE_DIR}/resources/notification.resource.ts`]: notificationResourceStub,
  [`${MODULE_DIR}/services/mark-notification-read.service.ts`]: markNotificationReadServiceStub,
  [`${MODULE_DIR}/controllers/list-notifications.controller.ts`]: listNotificationsControllerStub,
  [`${MODULE_DIR}/controllers/unread-notifications-count.controller.ts`]:
    unreadNotificationsCountControllerStub,
  [`${MODULE_DIR}/controllers/mark-notification-read.controller.ts`]:
    markNotificationReadControllerStub,
  [`${MODULE_DIR}/controllers/mark-all-notifications-read.controller.ts`]:
    markAllNotificationsReadControllerStub,
};

/**
 * Virtual file holding the broken shape: a plain `RequestHandler` reading
 * `request.locals.user.id`, without the module's guarded request type.
 */
const BROKEN_STUB_FILE = `${MODULE_DIR}/controllers/broken.controller.ts`;

const BROKEN_SNIPPET = `import { type RequestHandler } from "@warlock.js/core";
import { inApp } from "@warlock.js/notifications";

export const unreadNotificationsCountController: RequestHandler = async ({ request, response }) => {
  const count = await inApp.countUnread(request.locals.user.id);

  return response.success({ count });
};
`;

function compileVirtualFiles(files: Record<string, string>): Record<string, string[]> {
  return compileSources(TSCONFIG_TYPECHECK_PATH, files, {
    "@warlock.js/core/tests": [path.join(CORE_DIR, "src/tests/index.ts")],
  });
}

describe("the generated notifications module type-checks against the real @warlock.js/core + @warlock.js/notifications declarations", () => {
  // The transitive source graph is deliberately compiled once, including a
  // negative control. Leave enough time for a busy CI worker.
  it("compiles the module and authenticated specs, while rejecting unguarded user access", () => {
    const results = compileVirtualFiles({
      ...GENERATED_FILES,
      [BROKEN_STUB_FILE]: BROKEN_SNIPPET,
    });

    for (const file of Object.keys(GENERATED_FILES)) {
      expect({ file, errors: results[file] }).toEqual({ file, errors: [] });
    }
    expect(results[BROKEN_STUB_FILE]?.length).toBeGreaterThan(0);
  }, 240_000);
});
