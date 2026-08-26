import { FeatureDefinition } from "./types";

export const mailFeature: FeatureDefinition = {
  description: "Installs nodemailer for sending emails",
  dependencies: {
    nodemailer: "^8.0.5",
  },
  devDependencies: {
    "@types/nodemailer": "^8.0.0",
  },
};
