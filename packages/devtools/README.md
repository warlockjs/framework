# @warlock.js/devtools

A dashboard for Warlock.js apps. It runs in two modes:

- **Development**: served at `/__warlock`, for loopback clients only, with no sign-in.
- **Production monitor**: opt-in, served at a secret path behind accounts and two-factor sign-in.

It shows:

- a **request timeline**: router and page middleware, loaders, page cache, render and deferred values;
- every **SQL and Mongo query**, with `EXPLAIN`, and per-shape statistics;
- **N+1 warnings** that name the file and line;
- **routes**, **errors**, **logs**, **resources**, **health** and **jobs**;
- a **dev mailbox**, **cache operations**, and AI and agent traces in development.

## Install for development

```bash
warlock add devtools
warlock dev
# open http://localhost:<port>/__warlock
```

`warlock dev` loads it automatically. In development, nothing needs configuring.

## Production in five lines

1. Install it as a regular dependency: `npm install @warlock.js/devtools`.
2. Add `devtoolsConnector()`, `registerDevtoolsCommands()` and `devtoolsMigrations` to `warlock.config.ts`
   (from `@warlock.js/devtools` and `@warlock.js/devtools/production`), then run `warlock migrate`.
3. Set `production: { enabled: true }` in `src/config/devtools.ts`.
4. Set `DEVTOOLS_PATH`, `DEVTOOLS_ADMIN_EMAIL` and `DEVTOOLS_ADMIN_PASSWORD` (or `DEVTOOLS_SETUP_TOKEN`) in the environment.
5. Open `https://<your-app><DEVTOOLS_PATH>/` and sign in.

Without `production.enabled`, nothing is mounted and nothing is captured. The app refuses to start when the monitor
is enabled but misconfigured. Full guide: https://warlock.js.org/v/latest/devtools/production/

Optional: set `production.share.enabled` to let an admin give a read-only, expiring, revocable link to a panel that
declares a shared view (such as the Grimoire product map). The token is stored hashed; see the production guide.

## Safe by construction

- In development it answers loopback clients only. Anything else gets a 404, and `X-Forwarded-For` cannot unlock it.
- In production it is off until you enable it, answers a plain 404 to anyone without a session, and removes
  request values before anything is stored.

Full guide: [`skills/SKILL.md`](skills/SKILL.md).

## License

MIT
