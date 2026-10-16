---
title: Background file health checks
description: Configure TypeScript, ESLint and Oxlint checks while developing an app.
---

`warlock dev` checks source files in the background after boot and when saved files change. TypeScript runs by default. ESLint and Oxlint are detected independently at startup. ESLint uses core's bundled dependency and needs only an app-root flat configuration; Oxlint needs its app-installed package and an app-root configuration. Both run in dedicated workers when configured. These file checks report development diagnostics; HTTP `/health` and `/ready` probes are configured separately.

## Enable Oxlint

Install Oxlint in your app:

```bash
npm install --save-dev oxlint
# or
yarn add --dev oxlint
```

Add `.oxlintrc.json` at the app root:

```json
{
  "rules": {
    "no-debugger": "error",
    "no-unused-vars": "warn"
  }
}
```

Start `warlock dev`. The checker resolves the app's Oxlint CLI package and invokes it with the changed file list in a worker. JSON diagnostics become file errors and warnings, including their rule id, line, column and span. It reads saved files from disk, honors Oxlint config and ignore rules, and skips deleted and unsupported files. Empty change batches never trigger a whole-project scan. Large boot scans are split into sequential batches within platform command-line limits; file paths are passed relative to the app root. Tool/config errors include the CLI's output and are printed without stopping the dev server. The worker stops a running CLI child during shutdown.

Oxlint also discovers `.oxlintrc.jsonc`, `oxlint.config.ts` and `oxlint.config.mts`. Use JSON or JSONC at Warlock's Node.js 22.15 minimum; current Oxlint TypeScript configuration requires Node.js 22.18 or newer. See the [Oxlint configuration guide](https://oxc.rs/docs/guide/usage/linter/config.html).

## Select built-in checkers

```ts
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    healthCheckers: {
      typescript: true,
      eslint: false,
      oxlint: true,
    },
  },
});
```

Omitted switches keep automatic defaults. Set a switch to `false` to disable only that checker. Setting a linter to `true` still requires its app-root config; Oxlint also needs its package installed in the app. ESLint continues to use core's dependency even when the app does not depend on ESLint directly. Keep both `eslint` and `oxlint` enabled to run both; neither replaces the other's diagnostics. Restart the dev server after adding a new linter or its initial config.

Existing custom checker arrays keep replacing the complete built-in list. `devServer.healthCheckers: false` disables all checks, and `warlock dev --skip-health` overrides any checker configuration for that run. These switches are independent of `devServer.generateTypings`.
