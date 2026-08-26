import { communicatorsConfigStub } from "../stubs";
import { FeatureDefinition } from "./types";

export const heraldFeature: FeatureDefinition = {
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
};
