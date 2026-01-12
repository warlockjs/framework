import { colors } from "@mongez/copper";
import { fileExistsAsync, jsonFileAsync, putFileAsync } from "@mongez/fs";
import { execSync } from "node:child_process";
import { CommandActionData } from "../cli/types";
import { rootPath, srcPath } from "../utils";
import { communicatorsConfigStub } from "./stubs";

const featuresMap: Record<
  string,
  {
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
    description: string;
    ejectConfig?: {
      content: string;
      name: string;
    };
  }
> = {
  react: {
    description:
      "Installs React and React dom for SSR rendering, useful for sending mails using React components as well",
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
      nodemailer: "^6.9.14",
    },
    devDependencies: {
      "@types/nodemailer": "^7.0.4",
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
};

const allowedFeatures = Object.keys(featuresMap);

type PackageManager = "yarn" | "pnpm" | "npm";

export async function addCommandAction(options: CommandActionData) {
  const features = options.args;
  const { packageManager, list } = options.options;

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

  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const ejectConfigs: Record<string, { content: string; name: string }> = {};

  for (const feature of features) {
    const featurePackages = featuresMap[feature as keyof typeof featuresMap];
    Object.assign(dependencies, featurePackages.dependencies);
    if (featurePackages.devDependencies) {
      Object.assign(devDependencies, featurePackages.devDependencies);
    }

    if (featurePackages.ejectConfig) {
      ejectConfigs[featurePackages.ejectConfig.name] = featurePackages.ejectConfig;
    }
  }

  const currentPackageJson = await jsonFileAsync(rootPath("package.json"));

  // TODO: to reduce time of execution, check packages that are already installed

  const packageManagerCommand = await getPackageManagerCommand(packageManager as PackageManager);

  // check if dependencies are already installed
  for (const dependency of Object.keys(dependencies)) {
    if (currentPackageJson.dependencies[dependency]) {
      console.log(`${colors.yellowBright(dependency)} is already installed, skipping...`);
      delete dependencies[dependency];
      continue;
    }
  }

  // check if dev dependencies are already installed
  for (const devDependency of Object.keys(devDependencies)) {
    if (currentPackageJson.devDependencies[devDependency]) {
      console.log(`${colors.yellowBright(devDependency)} is already installed, skipping...`);
      delete devDependencies[devDependency];
      continue;
    }
  }

  // install dependencies
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

  // install dev dependencies
  if (Object.keys(devDependencies).length > 0) {
    console.log(
      `Installing dev dependencies ${colors.magenta(Object.keys(devDependencies).join(", "))}`,
    );
    execSync(`${packageManagerCommand} ${Object.keys(devDependencies).join(" ")}`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    console.log(
      `Dev dependencies installed successfully ${colors.green(Object.keys(devDependencies).join(", "))}`,
    );
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
