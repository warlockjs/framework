# @warlock.js/devtools

A development-only dashboard for Warlock.js apps, served at `/__warlock`:

- a **request timeline**: router and page middleware, loaders, page cache, render and deferred values;
- every **SQL and Mongo query**, with `EXPLAIN` for Postgres;
- **N+1 warnings** that name the file and line;
- a **dev mailbox** with every mail your app sent;
- **logs**, **cache operations** and the **route map**.

## Install

```bash
warlock add devtools
warlock dev
# open http://localhost:<port>/__warlock
```

That's all: `warlock dev` loads it automatically. Don't add it to
`warlock.config.ts`; it's a dev dependency, so a production install doesn't
have it.

## Safe by construction

- It isn't installed in production (it's a dev dependency).
- If it is present anyway, it refuses to run outside development.
- It answers loopback clients only. Anything else gets a 404, and
  `X-Forwarded-For` can't unlock it.
- Everything lives in memory, and nothing is written to disk.

Full guide: [`skills/devtools-overview/SKILL.md`](skills/devtools-overview/SKILL.md).

## License

MIT
