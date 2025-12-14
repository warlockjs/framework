/**
 * Initialize Seal with Warlock Framework Settings
 *
 * This file configures Seal to use Warlock's localization system
 */

// Auto-register framework plugins
import { trans } from "@mongez/localization";
import { configureSeal, registerPlugin } from "@warlock.js/seal";
import { t } from "../http/middleware/inject-request-context";
import { config } from "./../config";
import { databasePlugin, filePlugin, localizedPlugin } from "./plugins";

// Configure Seal to use Warlock's localization
configureSeal({
  translateRule({ rule, attributes }) {
    const translateRule = config.key("validation.schema.translateRule");
    if (translateRule) {
      return translateRule({ rule, attributes });
    }

    const translationGroup = config.key(
      "validation.schema.translationGroup",
      "validation",
    );

    const translationKey = `${translationGroup}.${rule.name}`;
    const translation = trans(translationKey, attributes);

    return translation === translationKey
      ? rule.errorMessage || rule.defaultErrorMessage
      : translation;
  },

  translateAttribute({ attribute, context, rule }) {
    const translateAttribute = config.key(
      "validation.schema.translateAttribute",
    );

    if (translateAttribute) {
      return translateAttribute({ attribute, context, rule });
    }

    return t(attribute, context.allValues);
  },
  firstErrorOnly: config.key("validation.schema.firstErrorOnly", true),
});

// Register plugins to inject methods
registerPlugin(databasePlugin);
registerPlugin(filePlugin);
registerPlugin(localizedPlugin);
