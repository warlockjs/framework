import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  getJsonFileAsync,
  putFileAsync,
  putJsonFileAsync,
} from "@warlock.js/fs";
import { execSync } from "node:child_process";
import { CommandActionData } from "../cli/types";
import { rootPath, srcPath } from "../utils";
import { getWarlockVersion } from "../utils/framework-vesion";
import {
  accessConfigStub,
  accessResolverStub,
  accessRoleMigrationStub,
  accessRoleModelIndexStub,
  accessRoleModelStub,
  accessUserRoleMigrationStub,
  accessUserRoleModelIndexStub,
  accessUserRoleModelStub,
  communicatorsConfigStub,
  notificationControllersStub,
  notificationMigrationStub,
  notificationModelStub,
  notificationRoutesStub,
  notificationsConfigStub,
  socketConfigStub,
} from "./stubs";

/**
 * Build a migration filename timestamp prefix in the framework's
 * MM-DD-YYYY_HH-MM-SS form. Cascade infers a migration's createdAt from this
 * prefix and orders migrations deterministically by it. Pass `offsetSeconds` to
 * stamp sibling migrations created in the same scaffold a second apart so they
 * never collide and keep a stable relative order.
 */
function migrationTimestamp(offsetSeconds = 0): string {
  const now = new Date(Date.now() + offsetSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

async function completeTestInstallation(options: CommandActionData) {
  // Create test-global-setup.ts (runs once before all tests)
  const testGlobalSetupPath = srcPath("test-global-setup.ts");
  const testGlobalSetupExists = await fileExistsAsync(testGlobalSetupPath);

  if (!testGlobalSetupExists) {
    await putFileAsync(
      testGlobalSetupPath,
      `/**
 * Global Test Setup
 *
 * Runs ONCE before all test workers.
 * Starts the HTTP server for integration tests.
 */
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core";

export async function setup() {
  await startHttpTestServer();
}

export async function teardown() {
  await stopHttpTestServer();
}
`,
    );
    console.log(`${colors.green("âœ“")} Created src/test-global-setup.ts`);
  }

  // Create test-setup.ts (runs per worker thread)
  const testSetupPath = srcPath("test-setup.ts");
  const testSetupExists = await fileExistsAsync(testSetupPath);

  if (!testSetupExists) {
    await putFileAsync(
      testSetupPath,
      `/**
 * Per-Worker Test Setup
 *
 * Runs in EACH Vitest worker thread before tests execute.
 * Sets up per-worker database and cache connections.
 */
import { setupTest } from "@warlock.js/core";

await setupTest({ connectors: true });
`,
    );
    console.log(`${colors.green("âœ“")} Created src/test-setup.ts`);
  }

  // Create vite.config.ts
  const viteConfigPath = rootPath("vite.config.ts");
  const viteConfigExists = await fileExistsAsync(viteConfigPath);

  if (!viteConfigExists) {
    await putFileAsync(
      viteConfigPath,
      `import { lowerStage3Decorators } from "@warlock.js/core";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // lowerStage3Decorators MUST come first: it lowers native (@RegisterModel, …)
  // decorators with esbuild before oxc / the SSR rewrite can mangle them, so
  // decorated Cascade models load under Vitest.
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts", // HTTP server - runs once
    setupFiles: ["./src/test-setup.ts"],       // DB/cache - runs per worker
    environment: "node",
    globals: false,
    include: ["src/app/**/*.test.ts"],
  },
});
`,
    );
    console.log(`${colors.green("âœ“")} Created vite.config.ts`);
  }
}

async function completeReactEmailInstallation(_options: CommandActionData) {
  // 1. Create emails/ folder with a sample component
  const emailsFolderPath = rootPath("emails");
  const sampleEmailPath = rootPath("emails/welcome-email.tsx");

  if (!(await fileExistsAsync(sampleEmailPath))) {
    await ensureDirectoryAsync(emailsFolderPath);
    await putFileAsync(
      sampleEmailPath,
      `import { Body, Container, Head, Html, Text } from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface WelcomeEmailProps {
  name: string;
}

/**
 * Sample welcome email component.
 * Preview with: yarn email:preview
 */
export default function WelcomeEmail({ name }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto max-w-xl py-8 px-4">
            <Text className="text-2xl font-bold text-gray-900">
              Welcome, {name}!
            </Text>
            <Text className="text-gray-600 mt-2">
              You're all set. We're glad to have you on board.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
`,
    );
    console.log(`${colors.green("âœ“")} Created emails/welcome-email.tsx`);
  }

  // 2. Patch tsconfig.json â€” add "emails" to include if missing
  const tsconfigPath = rootPath("tsconfig.json");
  const tsconfig = await getJsonFileAsync(tsconfigPath);

  if (!tsconfig.include) {
    tsconfig.include = [];
  }

  if (!tsconfig.include.includes("emails")) {
    tsconfig.include.push("emails");
    await putJsonFileAsync(tsconfigPath, tsconfig);
    console.log(`${colors.green("âœ“")} Added "emails" to tsconfig.json include`);
  }
}

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
  console.log(`${colors.green("âœ“")} Created src/app/notifications/notification.model.ts`);

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
    `${colors.green("âœ“")} Created src/app/notifications/migrations/${migrationFile}`,
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

const featuresMap: Record<
  string,
  {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    description: string;
    requires?: string[];
    script?: Record<string, string>;
    onExecuting?: (options: CommandActionData) => Promise<any>;
    ejectConfig?: {
      content: string;
      name: string;
    };
  }
> = {
  "react-email": {
    description: "Installs react-email for building email templates with React and Tailwind",
    requires: ["mail", "react"],
    dependencies: {
      "react-email": "^5.2.10",
      "@react-email/components": "^1.0.11",
      "@react-email/render": "^2.0.5",
      "@react-email/tailwind": "^2.0.7",
    },
    devDependencies: {
      "@react-email/preview-server": "5.2.10",
    },
    script: {
      "email:preview": "npx react-email dev",
    },
    onExecuting: completeReactEmailInstallation,
  },
  react: {
    description:
      "Installs React and React dom for rendering React components (non-interactive), useful for sending mails and generating HTML",
    dependencies: {
      react: "^19.2.3",
      "react-dom": "^19.2.3",
    },
    devDependencies: {
      "@types/react": "^19.2.7",
      "@types/react-dom": "^19.2.3",
    },
  },
  image: {
    description: "Installs sharp for image processing",
    dependencies: {
      sharp: "^0.34.5",
    },
  },
  mail: {
    description: "Installs nodemailer for sending emails",
    dependencies: {
      nodemailer: "^8.0.5",
    },
    devDependencies: {
      "@types/nodemailer": "^8.0.0",
    },
  },
  ses: {
    description: "Installs AWS SES SDK for sending emails via Amazon SES",
    dependencies: {
      "@aws-sdk/client-sesv2": "^3.1025.0",
    },
  },
  mongodb: {
    description: "Installs mongodb driver for database driver (Cascade Package)",
    dependencies: {
      mongodb: "^7.0.0",
    },
  },
  scheduler: {
    description: "Installs warlock scheduler for scheduling tasks",
    dependencies: {
      "@warlock.js/scheduler": "~4.0.0",
    },
  },
  // swagger / postman intentionally omitted — those packages do not exist yet;
  // they will ship together in the unified @warlock.js/api-docs package.
  postgres: {
    description: "Installs pg for Postgres database (Cascade Package)",
    dependencies: {
      pg: "^8.11.0",
    },
  },
  mysql: {
    description: "Installs mysql2 for MySQL database driver (Cascade Package)",
    dependencies: {
      mysql2: "^3.5.0",
    },
  },
  redis: {
    description: "Installs redis for Redis cache driver (Cache Package)",
    dependencies: {
      redis: "^4.6.13",
    },
  },
  s3: {
    description: "Installs AWS SDK for Cloud storage (Storage Package)",
    dependencies: {
      "@aws-sdk/client-s3": "^3.955.0",
      "@aws-sdk/lib-storage": "^3.955.0",
      "@aws-sdk/s3-request-presigner": "^3.955.0",
    },
  },
  test: {
    description: "Installs warlock test for testing",
    onExecuting: completeTestInstallation,
    script: {
      test: "vitest run",
      "test:coverage": "vitest run --coverage",
      "test:ui": "vitest --ui",
      "test:watch": "vitest --watch",
    },
    devDependencies: {
      "@mongez/vite": "^2.0.4",
      vite: "^8.0.16",
      vitest: "^4.1.8",
      "@vitest/coverage-v8": "^4.1.8",
    },
  },
  herald: {
    description: "Installs herald for message broker (Herald Package)",
    dependencies: {
      "@warlock.js/herald": "~4.0.0",
      amqplib: "^0.10.0",
    },
    devDependencies: {
      "@types/amqplib": "^0.10.0",
    },
    ejectConfig: {
      content: communicatorsConfigStub,
      name: "herald",
    },
  },
  socket: {
    description: "Installs socket.io for the realtime socket server (Socket Connector)",
    dependencies: {
      "socket.io": "^4.8.3",
    },
    ejectConfig: {
      content: socketConfigStub,
      name: "socket",
    },
  },
  notifications: {
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
  },
  access: {
    description:
      "Installs @warlock.js/access — authorization (RBAC + ABAC): permission checks, ABAC policies, and roles. Ejects config/access.ts, the DatabaseAccessResolver + Role/UserRole models and migrations into src/app/access, and registers the access locale in src/app/shared/utils/locales.ts",
    dependencies: {
      "@warlock.js/access": "~4.0.0",
    },
    ejectConfig: {
      content: accessConfigStub,
      name: "access",
    },
    onExecuting: completeAccessInstallation,
  },
  ai: {
    description: "Installs @warlock.js/ai — the core AI toolkit (agents, tools, workflows)",
    dependencies: {
      "@warlock.js/ai": "~4.0.0",
    },
  },
  openai: {
    description: "Installs the OpenAI provider for @warlock.js/ai (pulls the core ai package)",
    requires: ["ai"],
    dependencies: {
      "@warlock.js/ai-openai": "~4.0.0",
    },
  },
  google: {
    description: "Installs the Google (Gemini) provider for @warlock.js/ai (pulls the core ai package)",
    requires: ["ai"],
    dependencies: {
      "@warlock.js/ai-google": "~4.0.0",
    },
  },
  anthropic: {
    description: "Installs the Anthropic (Claude) provider for @warlock.js/ai (pulls the core ai package)",
    requires: ["ai"],
    dependencies: {
      "@warlock.js/ai-anthropic": "~4.0.0",
    },
  },
  bedrock: {
    description: "Installs the AWS Bedrock provider for @warlock.js/ai (pulls the core ai package)",
    requires: ["ai"],
    dependencies: {
      "@warlock.js/ai-bedrock": "~4.0.0",
    },
  },
  ollama: {
    description: "Installs the Ollama provider for @warlock.js/ai (pulls the core ai package)",
    requires: ["ai"],
    dependencies: {
      "@warlock.js/ai-ollama": "~4.0.0",
    },
  },
};

const allowedFeatures = Object.keys(featuresMap);

type PackageManager = "yarn" | "pnpm" | "npm";

function resolveFeatures(features: string[], visited = new Set<string>()): string[] {
  const resolved: string[] = [];

  for (const feature of features) {
    if (visited.has(feature)) continue;
    visited.add(feature);

    const def = featuresMap[feature];

    if (def.requires?.length) {
      resolved.push(...resolveFeatures(def.requires, visited));
    }

    resolved.push(feature);
  }

  return resolved;
}

export async function addCommandAction(options: CommandActionData) {
  const features = options.args;
  const { packageManager, list, noInstall } = options.options;

  if (list) {
    console.log("Available Features:");

    for (const feature of allowedFeatures) {
      console.log(
        `- ${colors.yellowBright(feature)}: ${colors.green(featuresMap[feature].description)}`,
      );
    }

    process.exit(0);
  }

  validateFeatures(features);

  const resolvedFeatures = resolveFeatures(features);

  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const ejectConfigs: Record<string, { content: string; name: string }> = {};
  const scripts: Record<string, string> = {};

  for (const feature of resolvedFeatures) {
    const featurePackages = featuresMap[feature as keyof typeof featuresMap];
    Object.assign(dependencies, featurePackages.dependencies);
    if (featurePackages.devDependencies) {
      Object.assign(devDependencies, featurePackages.devDependencies);
    }

    if (featurePackages.ejectConfig) {
      ejectConfigs[featurePackages.ejectConfig.name] = featurePackages.ejectConfig;
    }

    if (featurePackages.script) {
      Object.assign(scripts, featurePackages.script);
    }
  }

  // Pin every @warlock.js/* feature package to the INSTALLED framework version so
  // a scaffolded project's features match its core version instead of drifting to
  // the feature map's static range.
  const frameworkVersion = await getWarlockVersion();
  for (const dependency of Object.keys(dependencies)) {
    if (dependency.startsWith("@warlock.js/")) {
      dependencies[dependency] = frameworkVersion;
    }
  }

  const currentPackageJson = await getJsonFileAsync(rootPath("package.json"));

  // Fresh templates may omit one of the maps — guard before reading.
  currentPackageJson.dependencies = currentPackageJson.dependencies ?? {};
  currentPackageJson.devDependencies = currentPackageJson.devDependencies ?? {};

  // Skip anything already present so we never downgrade an existing pin.
  for (const dependency of Object.keys(dependencies)) {
    if (currentPackageJson.dependencies[dependency]) {
      console.log(`${colors.yellowBright(dependency)} is already installed, skipping...`);
      delete dependencies[dependency];
    }
  }

  for (const devDependency of Object.keys(devDependencies)) {
    if (currentPackageJson.devDependencies[devDependency]) {
      console.log(`${colors.yellowBright(devDependency)} is already installed, skipping...`);
      delete devDependencies[devDependency];
    }
  }

  if (noInstall) {
    await recordDependencies(dependencies, devDependencies);
  } else {
    await installDependencies(packageManager as PackageManager, dependencies, devDependencies);
  }

  for (const [name, config] of Object.entries(ejectConfigs)) {
    if (await fileExistsAsync(srcPath(`config/${name}.ts`))) {
      console.log(`${colors.yellowBright(name)} config already exists, skipping...`);
      continue;
    }

    console.log(`Creating ${colors.magenta(name)} config...`);

    await putFileAsync(srcPath(`config/${name}.ts`), config.content);

    console.log(`${colors.green(name)} config created successfully`);
  }

  // now loop again over features to execute onExecuting
  for (const feature of resolvedFeatures) {
    const featurePackages = featuresMap[feature as keyof typeof featuresMap];
    if (featurePackages.onExecuting) {
      await featurePackages.onExecuting(options);
    }
  }

  if (Object.keys(scripts).length > 0) {
    console.log(`Adding scripts ${colors.magenta(Object.keys(scripts).join(", "))}`);
    const packageJsonPath = rootPath("package.json");
    const packageJson = await getJsonFileAsync(packageJsonPath);
    packageJson.scripts = { ...(packageJson.scripts ?? {}), ...scripts };
    await putJsonFileAsync(packageJsonPath, packageJson);

    console.log(`Scripts added successfully ${colors.green(Object.keys(scripts).join(", "))}`);
  }
}

/**
 * Install the resolved dependency sets through the project's package manager.
 * Runs two passes (prod then dev) so each lands in the correct section.
 */
async function installDependencies(
  packageManager: PackageManager,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) {
  const packageManagerCommand = await getPackageManagerCommand(packageManager);

  if (Object.keys(dependencies).length > 0) {
    console.log(`Installing dependencies ${colors.magenta(Object.keys(dependencies).join(", "))}`);

    execSync(`${packageManagerCommand} ${Object.keys(dependencies).join(" ")}`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    console.log(
      `Dependencies installed successfully ${colors.green(Object.keys(dependencies).join(", "))}`,
    );
  }

  if (Object.keys(devDependencies).length > 0) {
    console.log(
      `Installing dev dependencies ${colors.magenta(Object.keys(devDependencies).join(", "))}`,
    );

    execSync(`${packageManagerCommand} ${Object.keys(devDependencies).join(" ")} -D`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    console.log(
      `Dev dependencies installed successfully ${colors.green(Object.keys(devDependencies).join(", "))}`,
    );
  }
}

/**
 * Write the resolved dependency sets into package.json without installing.
 * Used by `--no-install` so a scaffolder can batch every feature into one
 * install pass after the command returns. Versions come from the feature map.
 */
async function recordDependencies(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) {
  if (Object.keys(dependencies).length === 0 && Object.keys(devDependencies).length === 0) {
    return;
  }

  const packageJsonPath = rootPath("package.json");
  const packageJson = await getJsonFileAsync(packageJsonPath);

  packageJson.dependencies = packageJson.dependencies ?? {};
  packageJson.devDependencies = packageJson.devDependencies ?? {};

  Object.assign(packageJson.dependencies, dependencies);
  Object.assign(packageJson.devDependencies, devDependencies);

  await putJsonFileAsync(packageJsonPath, packageJson);

  const recorded = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

  console.log(
    `Recorded ${colors.green(recorded.join(", "))} in package.json (install skipped via --no-install)`,
  );
}

function validateFeatures(features: string[]) {
  for (const feature of features) {
    if (!allowedFeatures.includes(feature)) {
      console.log(
        `Feature ${colors.redBright(feature)} is not allowed, allowed features are: ${colors.green(allowedFeatures.join(", "))}`,
      );
      process.exit(1);
    }
  }
}

async function getPackageManagerCommand(packageManager?: PackageManager) {
  if (!packageManager) {
    // try to detect it through checking lock files
    packageManager = await detectPackageManager();
  }

  if (packageManager === "npm") {
    return "npm install";
  }

  if (packageManager === "yarn") {
    return "yarn add";
  }

  if (packageManager === "pnpm") {
    return "pnpm add";
  }
}

async function detectPackageManager() {
  if (await fileExistsAsync(rootPath("package-lock.json"))) {
    return "npm";
  }

  if (await fileExistsAsync(rootPath("yarn.lock"))) {
    return "yarn";
  }

  if (await fileExistsAsync(rootPath("pnpm-lock.yaml"))) {
    return "pnpm";
  }
}
