import { FeatureDefinition } from "./types";

export const reactFeature: FeatureDefinition = {
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
};
