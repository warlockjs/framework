import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import type { CommandActionData } from "../../commands/types";
import { srcPath } from "../../utils";
import {
  accessConfigStub,
  accessResolverStub,
  accessRoleMigrationStub,
  accessRoleModelIndexStub,
  accessRoleModelStub,
  accessUserRoleMigrationStub,
  accessUserRoleModelIndexStub,
  accessUserRoleModelStub,
} from "../stubs";
import { migrationTimestamp } from "./shared/migration-timestamp";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

async function registerAccessLocale() {
  const legacyLocalesPath = srcPath("app/shared/utils/locales.ts");
  const localesPath = srcPath("app/access/utils/locales.json");
  const forbidden = {
    en: "You do not have permission to perform this action.",
    ar: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
  };

  if (await fileExistsAsync(legacyLocalesPath)) {
    const legacy = await getFileAsync(legacyLocalesPath);
    if (legacy.includes(`groupedTranslations("access"`)) {
      console.log(`${colors.yellowBright("access")} locale already registered, skipping...`);
      return;
    }
  }

  if (await fileExistsAsync(localesPath)) {
    const current = await getFileAsync(localesPath);
    let dictionary: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(current);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      dictionary = parsed as Record<string, unknown>;
    } catch {
      console.log(
        `${colors.yellowBright("access")} locale JSON is invalid; add errors.forbidden to src/app/access/utils/locales.json manually.`,
      );
      return;
    }

    // A root `$group` renames the whole file's namespace; merging there would
    // register the sentence under a key the access checks never read.
    if (dictionary.$group !== undefined && dictionary.$group !== "access") {
      console.log(
        `${colors.yellowBright("access")} locale JSON declares a different $group; add access.errors.forbidden manually.`,
      );
      return;
    }

    const errors = dictionary.errors;
    if (
      errors !== undefined &&
      (errors === null || Array.isArray(errors) || typeof errors !== "object")
    ) {
      console.log(
        `${colors.yellowBright("access")} locale JSON cannot safely add errors.forbidden; update src/app/access/utils/locales.json manually.`,
      );
      return;
    }
    const entries = (errors ?? {}) as Record<string, unknown>;
    if (entries.forbidden !== undefined) return;

    entries.forbidden = forbidden;
    dictionary.errors = entries;
    await putFileAsync(localesPath, `${JSON.stringify(dictionary, null, 2)}\n`);
    console.log(
      `${colors.green("✓")} Registered the access locale in src/app/access/utils/locales.json`,
    );
    return;
  }

  await ensureDirectoryAsync(srcPath("app/access/utils"));
  await putFileAsync(localesPath, `${JSON.stringify({ errors: { forbidden } }, null, 2)}\n`);
  console.log(
    `${colors.green("✓")} Created src/app/access/utils/locales.json with the access locale`,
  );
}

async function scaffoldAccessFiles() {
  // The resolver file is the sentinel for "access already scaffolded" — its
  // presence means the role/user-role model folders and their timestamped
  // migrations were created too, so we must not re-emit duplicate migrations on
  // a second run.
  const resolverPath = srcPath("app/access/services/access-resolver.ts");

  if (await fileExistsAsync(resolverPath)) {
    console.log(
      `${colors.yellowBright("src/app/access")} already scaffolded, skipping resolver + role tables...`,
    );

    return;
  }

  // 1. Role catalog model folder (model + barrel + migration). The catalog row
  //    is role name → granted permissions; managed at runtime in the DB.
  await ensureDirectoryAsync(srcPath("app/access/models/role"));
  await putFileAsync(srcPath("app/access/models/role/role.model.ts"), accessRoleModelStub);
  await putFileAsync(srcPath("app/access/models/role/index.ts"), accessRoleModelIndexStub);
  console.log(`${colors.green("✓")} Created src/app/access/models/role`);

  await ensureDirectoryAsync(srcPath("app/access/models/role/migrations"));

  // Migration filenames carry a MM-DD-YYYY_HH-MM-SS prefix so cascade infers
  // their createdAt and orders them deterministically (the migrate action
  // discovers src/app/*/models/*/migrations/*). The two tables are independent
  // (no FK between them), but the user-role migration is stamped a second later
  // so the relative order is stable.
  const roleMigrationFile = `${migrationTimestamp()}-role.migration.ts`;
  await putFileAsync(
    srcPath("app/access/models/role/migrations", roleMigrationFile),
    accessRoleMigrationStub,
  );
  console.log(
    `${colors.green("✓")} Created src/app/access/models/role/migrations/${roleMigrationFile}`,
  );

  // 2. UserRole assignment model folder (model + barrel + migration). The model
  //    statics scope an unresolved tenant to GLOBAL rows only (security
  //    invariant) — see the stub for the reasoning.
  await ensureDirectoryAsync(srcPath("app/access/models/user-role"));
  await putFileAsync(
    srcPath("app/access/models/user-role/user-role.model.ts"),
    accessUserRoleModelStub,
  );
  await putFileAsync(srcPath("app/access/models/user-role/index.ts"), accessUserRoleModelIndexStub);
  console.log(`${colors.green("✓")} Created src/app/access/models/user-role`);

  await ensureDirectoryAsync(srcPath("app/access/models/user-role/migrations"));

  const userRoleMigrationFile = `${migrationTimestamp(1)}-user-role.migration.ts`;
  await putFileAsync(
    srcPath("app/access/models/user-role/migrations", userRoleMigrationFile),
    accessUserRoleMigrationStub,
  );
  console.log(
    `${colors.green("✓")} Created src/app/access/models/user-role/migrations/${userRoleMigrationFile}`,
  );

  // 3. The DatabaseAccessResolver — the one required config seam, wired into
  //    config/access.ts by the ejected stub.
  await ensureDirectoryAsync(srcPath("app/access/services"));
  await putFileAsync(resolverPath, accessResolverStub);
  console.log(`${colors.green("✓")} Created src/app/access/services/access-resolver.ts`);
}

async function completeAccessInstallation(_options: CommandActionData) {
  await registerAccessLocale();
  await scaffoldAccessFiles();
}

export const accessFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/access — authorization (RBAC + ABAC): permission checks, ABAC policies, and roles. Ejects config/access.ts, the DatabaseAccessResolver + Role/UserRole models and migrations into src/app/access, and registers the access locale in src/app/access/utils/locales.json",
  dependencies: {
    "@warlock.js/access": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: accessConfigStub,
    name: "access",
  },
  onExecuting: completeAccessInstallation,
};
