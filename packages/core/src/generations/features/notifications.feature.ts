import { colors } from "@mongez/copper";
import { dirname } from "node:path";
import {
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";
import type { CommandActionData } from "../../commands/types";
import { srcPath } from "../../utils";
import {
  listNotificationsControllerStub,
  listNotificationsSchemaStub,
  markAllNotificationsReadControllerStub,
  markNotificationReadControllerStub,
  markNotificationReadServiceStub,
  notificationControllerSpecStub,
  notificationTestFixtureStub,
  notificationLocalesStub,
  notificationMigrationStub,
  notificationModelStub,
  notificationResourceStub,
  notificationRoutesStub,
  notificationsConfigStub,
  notificationsRequestTypeStub,
  unreadNotificationsCountControllerStub,
} from "../stubs";
import { migrationTimestamp } from "./shared/migration-timestamp";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

/**
 * The module's controllers, with the route each one serves. A spec per
 * controller is written next to it when the app has the test feature.
 */
const notificationControllers = [
  {
    file: "list-notifications.controller",
    stub: listNotificationsControllerStub,
    method: "GET",
    path: "/notifications",
  },
  {
    file: "unread-notifications-count.controller",
    stub: unreadNotificationsCountControllerStub,
    method: "GET",
    path: "/notifications/unread-count",
  },
  {
    file: "mark-notification-read.controller",
    stub: markNotificationReadControllerStub,
    method: "PATCH",
    path: "/notifications/1/read",
  },
  {
    file: "mark-all-notifications-read.controller",
    stub: markAllNotificationsReadControllerStub,
    method: "PATCH",
    path: "/notifications/read-all",
  },
] as const;

/** The model's import path in the ejected config, before and since 5.30. */
const MODEL_IMPORT = "app/notifications/models/notification/notification.model";
const LEGACY_MODEL_IMPORT = "app/notifications/notification.model";

/**
 * Write one module file unless it already exists. A file the app already has
 * is the app's own code: it is reported and left alone, never overwritten.
 */
async function writeModuleFile(relativePath: string, content: string, skipped: string[]) {
  const path = srcPath("app/notifications", relativePath);

  if (await fileExistsAsync(path)) {
    skipped.push(relativePath);
    return;
  }

  await ensureDirectoryAsync(dirname(path));
  await putFileAsync(path, content);
  console.log(`${colors.green("✓")} Created src/app/notifications/${relativePath}`);
}

/**
 * Add the module's `notFound` message to an existing utils/locales.json, or
 * create the file. Existing keys win; a file that is not a JSON object, or
 * that renames its group, is left for the app to update by hand.
 */
async function registerNotificationLocales(skipped: string[]) {
  const localesPath = srcPath("app/notifications/utils/locales.json");

  if (!(await fileExistsAsync(localesPath))) {
    await writeModuleFile("utils/locales.json", notificationLocalesStub, skipped);
    return;
  }

  const defaults = JSON.parse(notificationLocalesStub) as Record<string, unknown>;
  let dictionary: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(await getFileAsync(localesPath));

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();

    dictionary = parsed as Record<string, unknown>;
  } catch {
    console.log(
      `${colors.yellowBright("notifications")} locale JSON is invalid; add notFound to src/app/notifications/utils/locales.json manually.`,
    );
    return;
  }

  // A root `$group` renames the file's namespace, so the service's
  // t("notifications.notFound") would not find a key merged here.
  if (dictionary.$group !== undefined && dictionary.$group !== "notifications") {
    console.log(
      `${colors.yellowBright("notifications")} locale JSON declares a different $group; add notifications.notFound manually.`,
    );
    return;
  }

  const missing = Object.keys(defaults).filter((key) => dictionary[key] === undefined);

  if (missing.length === 0) return;

  for (const key of missing) dictionary[key] = defaults[key];

  await putFileAsync(localesPath, `${JSON.stringify(dictionary, null, 2)}\n`);
  console.log(
    `${colors.green("✓")} Added ${missing.join(", ")} to src/app/notifications/utils/locales.json`,
  );
}

/**
 * The config ejected just before this runs imports the 5.30 model path. In an
 * app scaffolded by 5.29 the model is still at the module root, so point the
 * import there instead of at a file that does not exist.
 */
async function pointConfigAtLegacyModel() {
  const configPath = srcPath("config/notifications.ts");

  if (!(await fileExistsAsync(configPath))) return;

  const config = await getFileAsync(configPath);

  if (!config.includes(`"${MODEL_IMPORT}"`)) return;

  await putFileAsync(configPath, config.replace(`"${MODEL_IMPORT}"`, `"${LEGACY_MODEL_IMPORT}"`));
  console.log(
    `${colors.green("✓")} src/config/notifications.ts imports the existing model at ${LEGACY_MODEL_IMPORT}`,
  );
}

async function completeNotificationsInstallation(_options: CommandActionData) {
  const modelPath = srcPath("app/notifications/models/notification/notification.model.ts");
  // Where 5.29 and earlier wrote the model.
  const legacyModelPath = srcPath("app/notifications/notification.model.ts");

  // The model file is the sentinel for "notifications already scaffolded" —
  // its presence means the migration was created too (timestamped, so we must
  // not re-emit a duplicate on a second run).
  if (await fileExistsAsync(legacyModelPath)) {
    if (!(await fileExistsAsync(modelPath))) await pointConfigAtLegacyModel();

    console.log(
      `${colors.yellowBright("src/app/notifications")} already scaffolded (5.29 layout), skipping...`,
    );
    return;
  }

  if (await fileExistsAsync(modelPath)) {
    console.log(`${colors.yellowBright("src/app/notifications")} already scaffolded, skipping...`);
    return;
  }

  const skipped: string[] = [];
  // An app that already has its own notifications module may keep its model
  // anywhere in it; a second Notification model would collide with it.
  const moduleExists = await directoryExistsAsync(srcPath("app/notifications"));

  // 1. Model + migration under models/notification/, like every other module.
  //    The migration's MM-DD-YYYY_HH-MM-SS prefix lets cascade infer its
  //    createdAt and order it deterministically.
  if (moduleExists) {
    console.log(
      `${colors.yellowBright("src/app/notifications")} already exists: not adding a Notification model or migration. config/notifications.ts must import your model.`,
    );
  } else {
    await writeModuleFile(
      "models/notification/notification.model.ts",
      notificationModelStub,
      skipped,
    );
    await writeModuleFile(
      `models/notification/migrations/${migrationTimestamp()}-notification.migration.ts`,
      notificationMigrationStub,
      skipped,
    );
  }

  // 2. One responsibility per file: output resource, validated list query,
  //    guarded request type, service, translations.
  await writeModuleFile("resources/notification.resource.ts", notificationResourceStub, skipped);
  await writeModuleFile(
    "schema/list-notifications.schema.ts",
    listNotificationsSchemaStub,
    skipped,
  );
  await writeModuleFile(
    "types/notifications-request.type.ts",
    notificationsRequestTypeStub,
    skipped,
  );
  await writeModuleFile(
    "services/mark-notification-read.service.ts",
    markNotificationReadServiceStub,
    skipped,
  );
  await registerNotificationLocales(skipped);

  // 3. HTTP surface — list, unread count, mark read, mark all read, one
  //    controller per file, gated by authMiddleware in routes.ts.
  const withSpecs = await fileExistsAsync(srcPath("test-setup.ts"));
  if (withSpecs) {
    await writeModuleFile("tests/notifications.fixture.ts", notificationTestFixtureStub, skipped);
  }

  for (const controller of notificationControllers) {
    await writeModuleFile(`controllers/${controller.file}.ts`, controller.stub, skipped);

    if (withSpecs) {
      await writeModuleFile(
        `controllers/${controller.file}.spec.ts`,
        notificationControllerSpecStub(controller.method, controller.path),
        skipped,
      );
    }
  }

  await writeModuleFile("routes.ts", notificationRoutesStub, skipped);

  if (skipped.length > 0) {
    console.log(
      `${colors.yellowBright("Kept your existing files")} (not overwritten): ${skipped
        .map((file) => `src/app/notifications/${file}`)
        .join(", ")}`,
    );
  }
}

export const notificationsFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/notifications — multi-channel notifications (mail + in-app database). Pulls the mail feature, ejects config/notifications.ts, and scaffolds src/app/notifications: the Notification model + migration, a resource, a validated list query, and the recipient-scoped list / unread-count / mark-read / mark-all-read endpoints (one controller per file, a spec each when tests are set up)",
  // The ejected config wires a `mail` channel by default (needs nodemailer,
  // via the `mail` feature); the scaffolded routes are gated by
  // `authMiddleware`, so `@warlock.js/auth` is pulled in too.
  requires: ["mail"],
  dependencies: {
    "@warlock.js/notifications": INSTALLED_WARLOCK_VERSION,
    "@warlock.js/auth": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: notificationsConfigStub,
    name: "notifications",
  },
  onExecuting: completeNotificationsInstallation,
};
