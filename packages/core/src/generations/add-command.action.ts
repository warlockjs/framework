import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getJsonFileAsync,
  putFileAsync,
  putJsonFileAsync,
} from "@warlock.js/fs";
import { execSync } from "node:child_process";
import { CommandActionData } from "../cli/types";
import { rootPath, srcPath } from "../utils";
import { communicatorsConfigStub, socketConfigStub } from "./stubs";

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
      `import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [mongezVite()],
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
  swagger: {
    description: "Installs warlock swagger for API documentation",
    dependencies: {
      "@warlock.js/swagger": "~4.0.0",
    },
  },
  postman: {
    description: "Installs warlock postman for API documentation",
    dependencies: {
      "@warlock.js/postman": "~4.0.0",
    },
  },
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
      test: "vitest",
      "test:coverage": "vitest --coverage",
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
      name: "communicator",
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
