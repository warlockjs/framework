import { communicatorsConfigStub } from "../stubs";
import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const heraldFeature: FeatureDefinition = {
  description: "Installs herald for message broker (Herald Package)",
  dependencies: {
    "@warlock.js/herald": INSTALLED_WARLOCK_VERSION,
    amqplib: "^0.10.0",
  },
  devDependencies: {
    "@types/amqplib": "^0.10.0",
  },
  ejectConfig: {
    content: communicatorsConfigStub,
    name: "herald",
  },
};
