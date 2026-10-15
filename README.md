<div align="center">

<a href="https://warlock.js.org">
  <img src="docs/public/logo.png" alt="Warlock.js" width="120" height="120" />
</a>

# Warlock.js

**The full-stack TypeScript framework for server-rendered React, typed HTTP and data, and production-ready AI agents — in one application.**

[![CI](https://github.com/warlockjs/framework/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/warlockjs/framework/actions/workflows/ci.yml)
[![Docs](https://github.com/warlockjs/framework/actions/workflows/docs.yml/badge.svg?branch=main)](https://warlock.js.org)
[![npm](https://img.shields.io/npm/v/@warlock.js/core?label=%40warlock.js%2Fcore&color=f5b400)](https://www.npmjs.com/package/@warlock.js/core)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Documentation](https://warlock.js.org) · [Getting started](#getting-started) · [Packages](#packages) · [Contributing](#contributing) · [Changelog](https://warlock.js.org/changelog/)

</div>

---

## Why Warlock.js

Most Node.js stacks make you assemble a server, an ORM, a validator, a queue, an SSR layer and an AI SDK yourself — and then keep them in step forever. Warlock.js ships them as **one family of packages, released together at one version**, designed to share a lifecycle, a configuration model and a type system.

- **One application, every surface.** Server-rendered React pages, a typed HTTP API and AI agents live in the same codebase and boot in the same lifecycle.
- **Typed end to end.** Models, request schemas, resources, page loaders and agent tools are all TypeScript-first, and the whole family typechecks under `strict` with `noUncheckedIndexedAccess`.
- **Batteries included, never forced.** Heavy integrations (S3, SES, sharp, socket.io, provider SDKs) are optional peer dependencies — install one only when you use the feature that needs it.
- **Lockstep releases.** Every package is published at the same version after the whole family passes its typecheck, its tests, a local-registry install and an end-to-end application check.
- **AI that is part of the app.** Provider-agnostic agents, tools, teams, workflows, RAG, memory and guardrails, with adapters for every major model provider.

## Getting started

Create a new application with the scaffolder:

```bash
npx create-warlock@latest my-app
cd my-app
npm run dev
```

The wizard asks what you are building (full-stack web or API only), which database driver to use and which optional features to include — SSR pages, authorization, mail, storage, queues, notifications, AI providers and more — then generates a typed, ready-to-run project. Read the [getting-started guide](https://warlock.js.org) for a full walkthrough.

### A taste

```ts
// src/app/products/routes.ts — an HTTP API
import { router } from "@warlock.js/core";
import { createProduct, listProducts, showProduct } from "./controllers";

router.get("/api/products", listProducts);
router.post("/api/products", createProduct);
router.get("/api/products/:id", showProduct);
```

```tsx
// src/web/products/index.page.tsx — a server-rendered React page
import type { PageLoader, PageProps } from "@warlock.js/web";
import { catalog } from "app/products/catalog";
import ProductGrid from "./product-grid";

export const loader = (async () => ({
  products: await catalog.list(),
})) satisfies PageLoader;

export default function Products({ data }: PageProps<typeof loader>) {
  return <ProductGrid items={data.products} />;
}
```

```ts
// src/app/support/agents/triage.ts — an AI agent
import { ai } from "@warlock.js/ai";
import { openai } from "./providers";

export const supportAgent = ai.agent({
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: "Help customers choose a product.",
});
```

## Packages

All packages live in [`packages/`](packages) and are published to npm at the same version.

### Foundation

| Package | Description |
| --- | --- |
| [`@warlock.js/core`](packages/core) | The server framework: application lifecycle, HTTP router, controllers, responses, resources, repositories, CLI, mail, storage and security helpers. |
| [`@warlock.js/web`](packages/web) | Server-rendered React pages on Vite: loaders, layouts, streaming, hydration, navigation, forms and page actions. |
| [`@warlock.js/cascade`](packages/cascade) | Model-first ORM for MongoDB and PostgreSQL: models, relations, migrations, transactions, soft deletes and vector search. |
| [`@warlock.js/seal`](packages/seal) | Schema validation for request input and data, Standard Schema compatible. |
| [`@warlock.js/context`](packages/context) | Request-scoped context on `AsyncLocalStorage`, shared by the whole family. |
| [`create-warlock`](packages/create-warlock) | The project scaffolder: an interactive wizard and a non-interactive CLI. |

### Application services

| Package | Description |
| --- | --- |
| [`@warlock.js/auth`](packages/auth) | JWT authentication: login, logout and refresh with token rotation, an auth middleware, multiple user types and brute-force throttling. |
| [`@warlock.js/access`](packages/access) | Authorization with RBAC and ABAC: policies, gates, roles and permissions. |
| [`@warlock.js/cache`](packages/cache) | A cache manager with memory, Redis and custom drivers. |
| [`@warlock.js/queue`](packages/queue) | Durable background jobs on BullMQ and Redis: retries, backoff, progress and graceful shutdown. |
| [`@warlock.js/scheduler`](packages/scheduler) | Run jobs on a schedule. |
| [`@warlock.js/notifications`](packages/notifications) | Multi-channel notifications: mail, in-app and custom channels with preferences, rate limits and idempotency. |
| [`@warlock.js/herald`](packages/herald) | A message bus over RabbitMQ, Kafka and more. |
| [`@warlock.js/logger`](packages/logger) | Structured logging for messages and errors. |
| [`@warlock.js/fs`](packages/fs) | Filesystem primitives. |
| [`@warlock.js/sitemap`](packages/sitemap) | A framework-blind sitemap builder with zero runtime dependencies. |
| [`@warlock.js/devtools`](packages/devtools) | A development-only dashboard at `/__warlock`: request timeline, queries with `EXPLAIN`, N+1 detection, dev mailbox, logs and the route map. |

### AI

| Package | Description |
| --- | --- |
| [`@warlock.js/ai`](packages/ai) | Provider-agnostic LLM toolkit: agents, tools, teams, workflows, RAG, memory and guardrails. |
| [`@warlock.js/ai-tools`](packages/ai-tools) | Ready-made agent tools (web search, fetch, HTTP, calculator, date-time) and an MCP client and server. |
| [`@warlock.js/ai-workspace`](packages/ai-workspace) | A policy-jailed filesystem and shell workspace for agents. |
| [`@warlock.js/ai-panoptic`](packages/ai-panoptic) | Observability: a collector and exporters for traces of model and tool calls. |
| [`@warlock.js/ai-live`](packages/ai-live) | Realtime duplex voice sessions and text-to-video. |

**Model providers:** [`ai-openai`](packages/ai-openai) · [`ai-anthropic`](packages/ai-anthropic) · [`ai-google`](packages/ai-google) · [`ai-bedrock`](packages/ai-bedrock) · [`ai-mistral`](packages/ai-mistral) · [`ai-groq`](packages/ai-groq) · [`ai-deepseek`](packages/ai-deepseek) · [`ai-xai`](packages/ai-xai) · [`ai-ollama`](packages/ai-ollama)

## Repository layout

```text
framework/
├── packages/            every published package, one directory each
│   ├── core/
│   ├── web/
│   ├── cascade/
│   └── …
├── docs/                the documentation site (Astro + Starlight) → warlock.js.org
├── tools/release/       the release runner: gate, publish and confirm the family
├── scripts/             workspace-wide checks (spec coverage, CI package selection)
├── skills/              agent playbooks for working in this repository
└── .github/workflows/   CI, docs deployment, create-warlock and release pipelines
```

Each package keeps its own `README.md`, `CHANGELOG.md`, tests and agent skills. The full history of every package was carried over from its original repository, so `git log` and `git blame` work across the move.

## Development

**Requirements:** Node.js 22.13 or newer (CI uses Node 24) and [pnpm](https://pnpm.io) 11.24.0. With Corepack enabled, the right pnpm is picked up from `packageManager` automatically:

```bash
corepack enable
git clone https://github.com/warlockjs/framework.git
cd framework
pnpm install
```

Packages resolve each other from this repository, never from npm, so a change in `core` is immediately visible to `auth`, `web` and every other dependent.

### Common tasks

| Task | Command |
| --- | --- |
| Typecheck every package | `pnpm typecheck` |
| Test every package | `pnpm test` |
| Work on one package | `pnpm --filter @warlock.js/core test` |
| Typecheck one package | `pnpm --filter @warlock.js/core typecheck` |
| Run the docs site locally | `pnpm docs:dev` |
| Build the docs site | `pnpm docs:build` |
| Check formatting | `pnpm format:check` |
| List packages a branch affects | `pnpm ci:affected --base origin/main` |
| Move the whole family to a new version | `pnpm release:version 5.30.0` |

Some suites need services: `queue` and `notifications` expect Redis on port `6390`, and parts of `cascade` and `auth` start databases through Testcontainers, which needs Docker.

```bash
docker run -d --name warlock-redis -p 6390:6379 redis:7
```

### Continuous integration

| Workflow | Runs on | What it does |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | pull requests, `main`, nightly | Typechecks and tests every package a change affects, plus its dependents; all packages on `main` and nightly. |
| [`docs.yml`](.github/workflows/docs.yml) | changes to `docs/` or package changelogs | Builds the site and deploys it to GitHub Pages from `main`. |
| [`create-warlock.yml`](.github/workflows/create-warlock.yml) | changes to the scaffolder, nightly | Checks the scaffolder on its own install and typechecks a freshly scaffolded app against the published framework. |
| [`release.yml`](.github/workflows/release.yml) | manual | Gates, publishes and confirms the whole family at one version. |

## Releasing

The family is released in lockstep from GitHub Actions, never from a developer machine. Every package shares one version, so a release starts by moving all of them at once:

```bash
pnpm release:version 5.30.0   # every package, the exact family pins and the lockfile
```

Date each package's `## 5.30.0` CHANGELOG heading, commit, push, then dispatch the **release** workflow with that version:

1. **Gate** — strictness, every package's typecheck and tests, build, pack, and an install of the tarballs from a local registry.
2. **Application check** — a real application is built and exercised on the release tarballs.
3. **Publish** — only with `publish: true`, and only after the gate passes.
4. **Confirm** — the published versions are installed back from npm and checked, then `v<version>` is tagged.

See [`tools/release`](tools/release) for the details.

## Contributing

Contributions are welcome. Before opening a pull request:

1. Branch from `main` and keep the change focused on one concern.
2. Add or update tests next to the code you changed; a fix starts with a failing test.
3. Update the package's docs and its `CHANGELOG.md` in the same change.
4. Run `pnpm --filter <package> typecheck` and `pnpm --filter <package> test` for each package you touched.

CI must pass before a change is merged. Report security issues privately to the maintainers rather than in a public issue.

## License

[MIT](LICENSE) © Hassan Zohdy
