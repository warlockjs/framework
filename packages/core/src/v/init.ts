/**
 * Initialize Seal with Warlock Framework Settings
 *
 * This file configures Seal to use Warlock's localization system
 */

// Auto-register framework plugins
import { trans } from "@mongez/localization";
import { configureSeal, registerPlugin } from "@warlock.js/seal";
import { config } from "./../config";
import { databasePlugin, filePlugin } from "./plugins";

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
      ? rule.defaultErrorMessage || rule.errorMessage
      : translation;
  },

  translateAttribute({ attribute, context, rule }) {
    const translateAttribute = config.key(
      "validation.schema.translateAttribute",
    );
    if (translateAttribute) {
      return translateAttribute({ attribute, context, rule });
    }

    const translationGroup = config.key(
      "validation.schema.translationGroup",
      "validation",
    );

    let translationKey = `${translationGroup}.attributes.${rule.name}.${attribute}`;
    let translation = trans(translationKey, context.allValues);

    if (translation === translationKey) {
      // now check if there is a global attribute translation
      translationKey = `${translationGroup}.attributes.${attribute}`;
      translation = trans(translationKey, context.allValues);
    }

    return translation === translationKey ? attribute : translation;
  },
  firstErrorOnly: config.key("validation.schema.firstErrorOnly", true),
});

// Register plugins to inject methods
registerPlugin(databasePlugin);
registerPlugin(filePlugin);
