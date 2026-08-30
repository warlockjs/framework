import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
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
import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

async function registerAccessLocale() {
  // Register the access locale in the project's shared translations file so a
  // denied check returns a real sentence, not the raw "access.errors.forbidden"
  // key. Append when the file exists, create it otherwise; skip if already there.
  const localesPath = srcPath("app/shared/utils/locales.ts");

  const accessLocale = `groupedTranslations("access", {
  errors: {
    forbidden: {
      en: "You do not have permission to perform this action.",
      ar: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
    },
  },
});
`;

  if (await fileExistsAsync(localesPath)) {
    const current = await getFileAsync(localesPath);

    if (current.includes(`groupedTranslations("access"`)) {
      console.log(`${colors.yellowBright("access")} locale already registered, skipping...`);

      return;
    }

    // The file uses groupedTranslations already iff it calls it — only inject the
    // import when no call is present yet.
    const importLine = `import { groupedTranslations } from "@warlock.js/core";`;
    const prefix = current.includes("groupedTranslations(") ? "" : `${importLine}\n\n`;

    await putFileAsync(localesPath, `${prefix}${current.trimEnd()}\n\n${accessLocale}`);

    console.log(
      `${colors.green("✓")} Registered the access locale in src/app/shared/utils/locales.ts`,
    );

    return;
  }

  await ensureDirectoryAsync(srcPath("app/shared/utils"));

  await putFileAsync(
    localesPath,
    `import { groupedTranslations } from "@warlock.js/core";\n\n${accessLocale}`,
  );

  console.log(`${colors.green("✓")} Created src/app/shared/utils/locales.ts with the access locale`);
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
  await putFileAsync(
    srcPath("app/access/models/user-role/index.ts"),
    accessUserRoleModelIndexStub,
  );
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
    "Installs @warlock.js/access — authorization (RBAC + ABAC): permission checks, ABAC policies, and roles. Ejects config/access.ts, the DatabaseAccessResolver + Role/UserRole models and migrations into src/app/access, and registers the access locale in src/app/shared/utils/locales.ts",
  dependencies: {
    "@warlock.js/access": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: accessConfigStub,
    name: "access",
  },
  onExecuting: completeAccessInstallation,
};
