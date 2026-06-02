---
title: "Installation"
description: Scaffold a Warlock project, install dependencies, and boot the dev server — five minutes from zero.
sidebar:
  order: 2
  label: "Installation"
---

import { Tabs, TabItem } from "@astrojs/starlight/components";

Five minutes from zero to a Warlock project that boots. Three steps: scaffold, install, run.

## Prerequisites

- **Node.js 20+** (current active LTS).
- **A package manager** — npm, yarn, or pnpm. The scaffolder detects what you have installed and lets you pick during setup.

## Step 1 — Scaffold a project

Pick your package manager — the rest of this page assumes the same one end to end.

<Tabs syncKey="pm">
  <TabItem label="npm">
    ```bash
    npm create warlock@latest my-app
    cd my-app
    ```
  </TabItem>
  <TabItem label="yarn">
    ```bash
    yarn create warlock my-app
    cd my-app
    ```
  </TabItem>
  <TabItem label="pnpm">
    ```bash
    pnpm create warlock my-app
    cd my-app
    ```
  </TabItem>
</Tabs>

The scaffolder asks six questions and writes everything based on your answers:

1. **Project name** — the directory it creates.
2. **Package manager** — npm, yarn, or pnpm; auto-detected, you pick.
3. **Database driver** — MongoDB or PostgreSQL; Cascade (Warlock's ORM) wires the matching connector. (MySQL shows in the wizard marked "coming soon" — not wired yet.)
4. **Optional features** — multi-select: React (for HTML email rendering), image processing (Sharp), mail (Nodemailer), Redis cache driver, Scheduler, S3 storage, Herald (RabbitMQ). React is pre-checked because most apps eventually want it.
5. **Initialize Git?** — `git init` + first commit, your call.
6. **Generate JWT secret keys?** — drops a strong random `JWT_SECRET` into `.env`. Skip if you'll manage secrets yourself.

The scaffolder runs `<your-pm> install` for you at the end. If you cloned an existing Warlock project instead of scaffolding fresh, install manually:

<Tabs syncKey="pm">
  <TabItem label="npm">```bash
npm install
```</TabItem>
  <TabItem label="yarn">```bash
yarn install
```</TabItem>
  <TabItem label="pnpm">```bash
pnpm install
```</TabItem>
</Tabs>

## Step 2 — What got scaffolded

```
my-app/
  .env.example            sample env vars
  .gitattributes
  .husky/                 git hooks
  .prettierrc.json        formatter config
  .prettierignore
  .vscode/                editor settings + recommended extensions
  src/
    app/                  modules live here (one folder per feature)
    config/               one file per subsystem (http, mail, storage, …)
  public/                 static assets served as-is
  docs/                   project-local docs scaffold
  eslint.config.js
  package.json
  tsconfig.json           strict + decorators on + path aliases configured
  warlock.config.ts       project-level config (server, build, CLI extensions)
  README.md
```

Two layers of config and it's worth knowing which is which from the start:

- **`warlock.config.ts`** — the boot config. Server port, build settings, CLI extensions, dev-server flags. Resolved before anything else loads.
- **`src/config/*.ts`** — runtime config, one file per subsystem. Each file exports a default object that becomes available via `config.get("<filename>")` (whole namespace) or `config.get("<filename>.<key>")` (dot-notation) anywhere in your app.

## Step 3 — Boot the dev server

<Tabs syncKey="pm">
  <TabItem label="npm">```bash
npm run dev
```</TabItem>
  <TabItem label="yarn">```bash
yarn dev
```</TabItem>
  <TabItem label="pnpm">```bash
pnpm dev
```</TabItem>
</Tabs>

You'll see the dev server pick up your modules, start subsystem connectors (HTTP, database, cache, mail, storage, …) in priority order, and print the URL it's listening on. Open it — the framework prints a welcome response from the default route so you know the loop closed.

If a connector errors during startup (no DB reachable, port in use), the dev server fails loudly and exits with a clear message — better than hanging half-initialized.

## What you got

Three subsystems started, in order:

1. **`warlock.config.ts` loaded.** Server port, build settings, CLI extensions, dev-server flags resolved.
2. **`src/config/*.ts` merged.** Every file in `src/config/` exports a default object that becomes reachable via `config.get(...)` anywhere.
3. **HTTP connector booted.** Modules scanned, routes registered, server listening.

Your first endpoint is one page away.

## A note on decorators

Cascade (Warlock's ORM) registers models via `@RegisterModel()` and declares relations via `@BelongsTo` / `@HasMany`. The scaffolded `tsconfig.json` turns decorators on for you:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "strict": true,
    // …
  },
}
```

If you copy a `tsconfig.json` from elsewhere, **keep `experimentalDecorators: true`**. Without it the model registry stays empty, relations don't hoist, and you'll see confusing runtime errors that look unrelated to TypeScript settings.

## Next

Continue to [Configuration](./03-configuration.md) to learn what `warlock.config.ts` and `src/config/` actually control, and how `.env` plays in.
