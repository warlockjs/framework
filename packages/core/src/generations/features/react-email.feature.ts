import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getJsonFileAsync,
  putFileAsync,
  putJsonFileAsync,
} from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { rootPath } from "../../utils";
import { FeatureDefinition } from "./types";

/**
 * The part of a project `tsconfig.json` this action patches.
 */
type ProjectTsConfig = {
  include?: string[];
};

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
    console.log(`${colors.green("✓")} Created emails/welcome-email.tsx`);
  }

  // 2. Patch tsconfig.json â€” add "emails" to include if missing
  const tsconfigPath = rootPath("tsconfig.json");
  const tsconfig = await getJsonFileAsync<ProjectTsConfig>(tsconfigPath);

  if (!tsconfig.include) {
    tsconfig.include = [];
  }

  if (!tsconfig.include.includes("emails")) {
    tsconfig.include.push("emails");
    await putJsonFileAsync(tsconfigPath, tsconfig);
    console.log(`${colors.green("✓")} Added "emails" to tsconfig.json include`);
  }
}

export const reactEmailFeature: FeatureDefinition = {
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
};
