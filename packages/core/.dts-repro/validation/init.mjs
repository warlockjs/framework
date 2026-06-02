import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { t } from "../http/middleware/inject-request-context.mjs";
import { databasePlugin } from "./plugins/database-plugin.mjs";
import { filePlugin } from "./plugins/file-plugin.mjs";
import { localizedPlugin } from "./plugins/localized-plugin.mjs";
import "./plugins/index.mjs";
import { configureSeal, registerPlugin } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/init.ts
/**
* Initialize Seal with Warlock Framework Settings
*
* This file configures Seal to use Warlock's localization system
*/
configureSeal({
	firstErrorOnly: config.key("validation.firstErrorOnly", true),
	translateRule({ rule, attributes }) {
		const translateRule = config.key("validation.translateRule");
		if (translateRule) return translateRule({
			rule,
			attributes
		});
		const translationKey = `${config.key("validation.translationGroup", "validation")}.${rule.name}`;
		const translation = t(translationKey, attributes);
		return translation === translationKey ? rule.errorMessage || rule.defaultErrorMessage : translation;
	},
	translateAttribute({ attribute, context, rule }) {
		const translateAttribute = config.key("validation.translateAttribute");
		if (translateAttribute) return translateAttribute({
			attribute,
			context,
			rule
		});
		const attributeGroup = config.key("validation.attributeGroup") ?? "attributes";
		const translationKey = `${attributeGroup ? attributeGroup + "." : ""}${attribute}`;
		const output = t(translationKey, context.allValues);
		return output === translationKey ? attribute : output;
	}
});
registerPlugin(databasePlugin);
registerPlugin(filePlugin);
registerPlugin(localizedPlugin);
//#endregion
export {};

//# sourceMappingURL=init.mjs.map