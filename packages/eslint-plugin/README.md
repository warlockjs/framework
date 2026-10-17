# @warlock.js/eslint-plugin

ESLint rules for [Warlock.js](https://warlock.js.org) applications. They encode
the framework's conventions and the security mistakes that are easiest to ship:
unvalidated input reaching the database, mutating routes without an auth guard,
open redirects, secrets in logs and regexes that a crafted input can stall.

New apps created with `create-warlock` (ESLint mode) already have it installed
and enabled.

## Install

```bash
npm install --save-dev @warlock.js/eslint-plugin
```

## Use it

```js
// eslint.config.js
import warlock from "@warlock.js/eslint-plugin";

export default [
  // ...your TypeScript parser setup
  warlock.configs.recommended,
];
```

`warlock.configs.strict` turns every rule on as an error, including the
convention-only rules. To configure one rule:

```js
export default [
  warlock.configs.recommended,
  {
    rules: {
      "@warlock.js/require-route-guard": ["error", { guardFunctions: ["guarded", "adminOnly"] }],
    },
  },
];
```

## Rules

| Rule                                                                                                              | Recommended | Fix        | What it catches                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | -------------------------------------------------------------------------- |
| [`no-request-all`](https://warlock.js.org/v/latest/eslint-plugin/rules/no-request-all/)                           | error       | suggestion | `request.all()` passed to a query, service or `inApp()` (mass assignment)  |
| [`require-route-guard`](https://warlock.js.org/v/latest/eslint-plugin/rules/require-route-guard/)                 | error       | suggestion | POST/PUT/PATCH/DELETE routes with no auth middleware and no `public: true` |
| [`safe-redirect`](https://warlock.js.org/v/latest/eslint-plugin/rules/safe-redirect/)                             | error       | suggestion | redirect, `navigateTo()` or `<Link to>` targets taken from request input   |
| [`no-sensitive-log`](https://warlock.js.org/v/latest/eslint-plugin/rules/no-sensitive-log/)                       | error       | —          | raw emails, credentials and request bodies in log calls                    |
| [`no-unbounded-regex-on-input`](https://warlock.js.org/v/latest/eslint-plugin/rules/no-unbounded-regex-on-input/) | error       | —          | `*`, `+`, `{n,}` in a regex applied to request input (ReDoS)               |
| [`no-await-log`](https://warlock.js.org/v/latest/eslint-plugin/rules/no-await-log/)                               | warn        | autofix    | `await log.info(…)` (log calls are synchronous)                            |
| [`no-js-import-extension`](https://warlock.js.org/v/latest/eslint-plugin/rules/no-js-import-extension/)           | error       | autofix    | `./user.model.js` in relative imports                                      |
| [`one-controller-per-file`](https://warlock.js.org/v/latest/eslint-plugin/rules/one-controller-per-file/)         | strict      | —          | several controllers in one file                                            |
| [`prefer-type-discriminator`](https://warlock.js.org/v/latest/eslint-plugin/rules/prefer-type-discriminator/)     | strict      | —          | `kind: "a" \| "b"` instead of `type` in tagged unions                      |

Suggestions are offered in the editor (and by `eslint --fix-type suggestion`
tooling) rather than applied by `--fix`, because each one is a decision: a
route marked `public: true` is reachable by anyone.

## Oxlint

Oxlint can load ESLint plugins through `jsPlugins`, but in the Oxlint version
Warlock pins (1.88) that feature is alpha and not covered by semver. The plugin
is therefore supported and tested with ESLint only; `create-warlock --lint=oxc`
projects do not include it.

## Docs

https://warlock.js.org/v/latest/eslint-plugin/
