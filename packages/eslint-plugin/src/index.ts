import type { ESLint, Linter, Rule } from "eslint";
import { noAwaitLog } from "./rules/no-await-log";
import { noJsImportExtension } from "./rules/no-js-import-extension";
import { noRequestAll } from "./rules/no-request-all";
import { noSensitiveLog } from "./rules/no-sensitive-log";
import { noUnboundedRegexOnInput } from "./rules/no-unbounded-regex-on-input";
import { oneControllerPerFile } from "./rules/one-controller-per-file";
import { preferTypeDiscriminator } from "./rules/prefer-type-discriminator";
import { requireRouteGuard } from "./rules/require-route-guard";
import { safeRedirect } from "./rules/safe-redirect";

export { findUnboundedQuantifier } from "./rules/no-unbounded-regex-on-input";
export { DOCS_BASE_URL } from "./utils/ast";

/** The namespace rules are configured under: `"@warlock.js/no-request-all"`. */
export const PLUGIN_NAMESPACE = "@warlock.js";

export const rules = {
  "no-request-all": noRequestAll,
  "require-route-guard": requireRouteGuard,
  "safe-redirect": safeRedirect,
  "no-sensitive-log": noSensitiveLog,
  "no-unbounded-regex-on-input": noUnboundedRegexOnInput,
  "no-await-log": noAwaitLog,
  "one-controller-per-file": oneControllerPerFile,
  "prefer-type-discriminator": preferTypeDiscriminator,
  "no-js-import-extension": noJsImportExtension,
} satisfies Record<string, Rule.RuleModule>;

export type WarlockRuleName = keyof typeof rules;

type RuleSeverities = Partial<
  Record<`${typeof PLUGIN_NAMESPACE}/${WarlockRuleName}`, Linter.RuleEntry>
>;

/** Security rules plus the conventions with no false positives in a fresh app. */
const recommendedRules: RuleSeverities = {
  "@warlock.js/no-request-all": "error",
  "@warlock.js/require-route-guard": "error",
  "@warlock.js/safe-redirect": "error",
  "@warlock.js/no-sensitive-log": "error",
  "@warlock.js/no-unbounded-regex-on-input": "error",
  "@warlock.js/no-await-log": "warn",
  "@warlock.js/no-js-import-extension": "error",
};

/** Every rule, all as errors. */
const strictRules: RuleSeverities = {
  ...recommendedRules,
  "@warlock.js/no-await-log": "error",
  "@warlock.js/one-controller-per-file": "error",
  "@warlock.js/prefer-type-discriminator": "error",
};

export type WarlockPlugin = ESLint.Plugin & {
  rules: typeof rules;
  configs: {
    recommended: Linter.Config;
    strict: Linter.Config;
  };
};

const plugin: WarlockPlugin = {
  meta: { name: "@warlock.js/eslint-plugin" },
  rules,
  configs: {
    recommended: { name: "@warlock.js/recommended", rules: recommendedRules },
    strict: { name: "@warlock.js/strict", rules: strictRules },
  },
};

// Flat configs reference the plugin object itself, so they are attached after
// it exists: `export default [warlock.configs.recommended]` needs no `plugins`.
plugin.configs.recommended.plugins = { [PLUGIN_NAMESPACE]: plugin };
plugin.configs.strict.plugins = { [PLUGIN_NAMESPACE]: plugin };

export const configs: WarlockPlugin["configs"] = plugin.configs;

export default plugin;
