import { aiConfigStub } from "../stubs";
import { FeatureDefinition } from "./types";

export const aiFeature: FeatureDefinition = {
  description: "Installs @warlock.js/ai — the core AI toolkit (agents, tools, workflows)",
  dependencies: {
    "@warlock.js/ai": "~4.0.0",
  },
  ejectConfig: {
    content: aiConfigStub,
    name: "ai",
  },
};
