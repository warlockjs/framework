import { FeatureDefinition } from "./types";

export const s3Feature: FeatureDefinition = {
  description: "Installs AWS SDK for Cloud storage (Storage Package)",
  dependencies: {
    "@aws-sdk/client-s3": "^3.955.0",
    "@aws-sdk/lib-storage": "^3.955.0",
    "@aws-sdk/s3-request-presigner": "^3.955.0",
  },
};
