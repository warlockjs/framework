import type { FeatureDefinition } from "./types";

export const mailFeature: FeatureDefinition = {
  description: "Installs nodemailer for sending emails",
  dependencies: {
    nodemailer: "^10.1.4",
  },
};
