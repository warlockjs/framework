import { registerPlugin } from "@warlock.js/seal";
import { embedValidator } from "./plugins/embed-validator-plugin";

// We need to introduce new validators
// 1. v.embed(model: typeof Model, options: EmbedOptions)
// 2. v.embedMany(model: typeof Model, options: EmbedManyOptions)

registerPlugin(embedValidator);
