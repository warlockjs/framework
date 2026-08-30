import { aiConfigStub } from "../stubs";
import { FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

export const aiFeature: FeatureDefinition = {
  description: "Installs @warlock.js/ai — the core AI toolkit (agents, tools, workflows)",
  dependencies: {
    "@warlock.js/ai": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: aiConfigStub,
    name: "ai",
  },
};
