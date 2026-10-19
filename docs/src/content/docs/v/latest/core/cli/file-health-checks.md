---
title: Background file health checks
description: Configure TypeScript and Oxlint checks while developing an app.
---

`warlock dev` checks saved source files after boot and as they change. TypeScript
and configured, app-installed Oxlint run in dedicated workers by default. HTTP
`/health` and `/ready` probes are configured separately. ESLint support was
removed in 5.34.0; see [toolchain migration](./toolchain).

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

Start `warlock dev`. The checker resolves the app's Oxlint CLI package and invokes it with the changed file list in a worker. JSON diagnostics become file errors and warnings, including their rule id, line, column and span. It reads saved files from disk, honors Oxlint config and ignore rules, and skips deleted and unsupported files. Empty change batches never trigger a whole-project scan. Large boot scans are split into sequential batches within platform command-line limits (counting each argument's `argv` pointer on POSIX systems) and at most 500 files each; file paths are passed relative to the app root. A batch whose JSON report overflows the 8 MiB output buffer is split in half and retried, down to single files. A path too long for the conservative budget runs in a batch of its own, and if the operating system still refuses it (`E2BIG`/`ENAMETOOLONG`) only that file is reported as an unchecked warning; the rest of the scan continues. Tool/config errors include the CLI's output and are printed without stopping the dev server. During shutdown the worker sends SIGTERM to a running CLI child and SIGKILL 250 ms later if it is still running; a check cut short this way reports "Oxlint check cancelled: the development server is shutting down." and is not printed as a failure.

Oxlint also discovers `.oxlintrc.jsonc`, `oxlint.config.ts` and `oxlint.config.mts`. Use JSON or JSONC at Warlock's Node.js 22.15 minimum; current Oxlint TypeScript configuration requires Node.js 22.18 or newer. See the [Oxlint configuration guide](https://oxc.rs/docs/guide/usage/linter/config.html).

## Select built-in checkers

```ts
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    healthCheckers: {
      typescript: true,
      oxlint: true,
    },
  },
});
```

Omitted switches keep TypeScript on and Oxlint on when its app-root config and
package exist. Set either switch to `false` to disable that checker. Restart the
dev server after installing Oxlint or adding its initial config.

Existing custom checker arrays keep replacing the complete built-in list. `devServer.healthCheckers: false` disables all checks, and `warlock dev --skip-health` overrides any checker configuration for that run. These switches are independent of `devServer.generateTypings`.

Oxlint config failures preserve both warning and error output; structured
diagnostics keep their specific message. Command failure messages contain a
bounded status/output summary, without the batch command line. Shutdown gives
workers up to 500 ms to exit and reap owned CLI children before forcing termination.

Source TypeScript health workers use the framework's JavaScript bootstrap to
register tsx inside each worker on Node.js 22.15 and Node.js 24. Registration
remains active for later TypeScript imports and lets native dependencies load
Node builtins through `createRequire`. Published JavaScript workers start
directly. Their TypeScript and native parser dependencies remain external and
resolve from core's installed dependencies; native optional bindings load from
the parser package's own location. Regression tests cover both paths without
inherited loader hooks, including configured declaration roots, source updates
and deleted declarations.
