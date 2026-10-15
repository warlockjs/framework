# WR-004: Local TypeScript configuration imports fail to load

Package: `@warlock.js/core` 5.29.0; Node 22.13.0; application TypeScript 5.9.3.

Expected: the canonical `warlock.config.ts` local connector pattern loads an
extensionless TypeScript import and its configured project aliases before
`generate.typings` or `build` starts.

Actual: the unpatched configuration manager first imports TypeScript natively.
Its fallback transpiles only `warlock.config.ts` into a sibling `.mjs`, leaving
local TypeScript imports unresolved. A configuration importing
`./src/connectors/local` therefore fails even when application typechecking passes.

Reproducer: in an owned temporary project on Node 22.13, create a local TypeScript
connector extending external `BaseConnector`, import it without an extension
from `warlock.config.ts`, and invoke `new WarlockConfigManager().load()`. Include
a connector import through an `app/*` tsconfig alias to cover the full local graph.
The executable reproducer is `scripts/check-core-config-patch.spec.mjs`;
it uses disposable Node child processes.

Workaround: the retained pnpm patch
`patches/@warlock.js__core@5.29.0.patch` bundles the local configuration graph
with esbuild while keeping packages external. This preserves `BaseConnector`
and container identity, executes user configuration once, keeps original user
errors and removes temporary modules on success and failure. Ordinary pnpm
installation applies the lockfile-pinned patch; installed files are not edited.

Qualification: all three actual Node fixture cases pass on Node 22.13, covering
extensionless imports, aliases, external identities, single execution,
configuration-root assets, errors and temporary-file cleanup. Other Node binaries
remain unqualified. Inlined local modules observe the configuration-root
`import.meta.url`, so assets relative to their original subdirectory require an
explicit rooted path with this workaround.

Request: fix the portable configuration loader upstream and add these import-graph
regressions across supported Node versions. This is a confirmed configuration
loading defect, separate from the HTTP request parser.

Evidence and patch scope: [core-config-loader-rebuild.md](core-config-loader-rebuild.md).

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
