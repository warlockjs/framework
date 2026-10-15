/**
 * Initialize Seal with Warlock Framework Settings
 *
 * This file configures Seal to use Warlock's localization system
 */

// Auto-register framework plugins
import { configureSeal, getSealConfig, registerPlugin } from "@warlock.js/seal";
import { config } from "../config";
import { t } from "../http/middleware/inject-request-context";
import { databasePlugin, filePlugin, localizedPlugin } from "./plugins";

// Configure Seal to use Warlock's localization
configureSeal({
  translateRule({ rule, attributes }) {
    const translateRule = config.key("validation.translateRule");

    if (translateRule) {
      return translateRule({ rule, attributes });
    }

    const translationGroup = config.key("validation.translationGroup", "validation");

    const translationKey = `${translationGroup}.${rule.name}`;
    const translation = t(translationKey, attributes);

    return translation === translationKey
      ? rule.errorMessage || rule.defaultErrorMessage
      : translation;
  },

  translateAttribute({ attribute, context, rule }) {
    const translateAttribute = config.key("validation.translateAttribute");

    if (translateAttribute) {
      return translateAttribute({ attribute, context, rule });
    }

    const attributeGroup = config.key("validation.attributeGroup") ?? "attributes";

    const translationKey = `${attributeGroup ? attributeGroup + "." : ""}${attribute}`;

    const output = t(translationKey, context.allValues);
    return output === translationKey ? attribute : output;
  },
});

// App config is not loaded yet when this module is imported, so resolve
// firstErrorOnly lazily on every read instead of capturing it once.
Object.defineProperty(getSealConfig(), "firstErrorOnly", {
  configurable: true,
  enumerable: true,
  get: () => config.key("validation.firstErrorOnly", true),
});

// Register plugins to inject methods
registerPlugin(databasePlugin);
registerPlugin(filePlugin);
registerPlugin(localizedPlugin);
