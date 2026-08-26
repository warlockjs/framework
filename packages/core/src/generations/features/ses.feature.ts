import { FeatureDefinition } from "./types";

export const sesFeature: FeatureDefinition = {
  description: "Installs AWS SES SDK for sending emails via Amazon SES",
  dependencies: {
    "@aws-sdk/client-sesv2": "^3.1025.0",
  },
};
