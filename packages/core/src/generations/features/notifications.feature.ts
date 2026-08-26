import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, fileExistsAsync, putFileAsync } from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { srcPath } from "../../utils";
import {
  notificationControllersStub,
  notificationMigrationStub,
  notificationModelStub,
  notificationRoutesStub,
  notificationsConfigStub,
} from "../stubs";
import { migrationTimestamp } from "./shared/migration-timestamp";
import { FeatureDefinition } from "./types";

async function completeNotificationsInstallation(_options: CommandActionData) {
  const modelPath = srcPath("app/notifications/notification.model.ts");

  // The model file is the sentinel for "notifications already scaffolded" —
  // its presence means the migration was created too (timestamped, so we must
  // not re-emit a duplicate on a second run).
  if (await fileExistsAsync(modelPath)) {
    console.log(
      `${colors.yellowBright("src/app/notifications")} already scaffolded, skipping model + migration...`,
    );
    return;
  }

  // 1. Notification model — extends the package's DatabaseNotification base.
  await ensureDirectoryAsync(srcPath("app/notifications"));
  await putFileAsync(modelPath, notificationModelStub);
  console.log(`${colors.green("✓")} Created src/app/notifications/notification.model.ts`);

  // 2. Migration — timestamped MM-DD-YYYY_HH-MM-SS prefix so cascade infers its
  //    createdAt and orders it deterministically (migrate-action discovers
  //    src/app/*/migrations/*).
  await ensureDirectoryAsync(srcPath("app/notifications/migrations"));

  const migrationFile = `${migrationTimestamp()}-notification.migration.ts`;

  await putFileAsync(
    srcPath("app/notifications/migrations", migrationFile),
    notificationMigrationStub,
  );
  console.log(
    `${colors.green("✓")} Created src/app/notifications/migrations/${migrationFile}`,
  );

  // 3. HTTP surface — the in-app read/dismiss endpoints (routes + controllers),
  //    gated by authMiddleware. Delete if the app exposes notifications another way.
  await ensureDirectoryAsync(srcPath("app/notifications/controllers"));
  await putFileAsync(
    srcPath("app/notifications/controllers/notifications.controller.ts"),
    notificationControllersStub,
  );
  await putFileAsync(srcPath("app/notifications/routes.ts"), notificationRoutesStub);
  console.log(`${colors.green("✓")} Created src/app/notifications/routes.ts + controllers`);
}

export const notificationsFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/notifications — multi-channel notifications (mail + in-app database). Pulls the mail feature, ejects config/notifications.ts, and scaffolds the Notification model + migration plus the recipient-scoped read/dismiss routes + controllers into src/app/notifications",
  // The ejected config wires a `mail` channel by default (needs nodemailer,
  // via the `mail` feature); the scaffolded routes are gated by
  // `authMiddleware`, so `@warlock.js/auth` is pulled in too.
  requires: ["mail"],
  dependencies: {
    "@warlock.js/notifications": "~4.0.0",
    "@warlock.js/auth": "~4.0.0",
  },
  ejectConfig: {
    content: notificationsConfigStub,
    name: "notifications",
  },
  onExecuting: completeNotificationsInstallation,
};
