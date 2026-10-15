---
title: "Configuration"
sidebar:
  order: 3
  label: "Configuration"
---

Cascade is configured by an object and connected with one function call. This page shows the smallest config that works. Once you're shipping models and want to tune behavior — naming conventions, timestamps, soft-delete defaults, all that — the configuration guide goes deep. For now, we just want a connection.

## Prerequisites

- [Cascade installed](./02-installation.md)
- A database reachable from your machine (MongoDB or Postgres running locally, or a connection string you trust)

## Connect

Define the config object next to your `connectToDatabase` call, wherever your app starts running code — `main.ts`, `server.ts`, your framework's bootstrap, whatever. Cascade has no opinion on project structure; the call just needs to happen once at boot:

```ts
import {
  connectToDatabase,
  type ConnectionOptions,
  type MongoClientOptions,
  type MongoDriverOptions,
} from "@warlock.js/cascade";

const databaseConfig: ConnectionOptions<MongoDriverOptions, MongoClientOptions> = {
  driver: "mongodb",
  name: "default",
  database: "my_app",
  host: "localhost",
  port: 27017,
};

await connectToDatabase(databaseConfig);
```

Three fields are doing the load-bearing work:

- **`driver`** picks the driver — `"mongodb"` or `"postgres"`. The `ConnectionOptions<MongoDriverOptions, MongoClientOptions>` generic threads driver-specific options through, so autocomplete will only show you the ones that apply.
- **`name`** is the data-source identifier. `"default"` is fine — you'll only need a different name when you have more than one database.
- **`database`** / **`host`** / **`port`** describe where to connect.

Cascade opens the connection, registers the data source under the name you gave it, and from this moment on every model query in your app routes through it. No client object to pass around, no singleton to import, no context to wrap your handlers in. Just `User.where(...)` and friends.

### In production — use environment variables

The literals above are for clarity. Real apps don't hardcode credentials:

```ts
const databaseConfig: ConnectionOptions<MongoDriverOptions, MongoClientOptions> = {
  driver: "mongodb",
  name: "default",
  database: process.env.DB_NAME!,
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 27017),
};
```

Same shape, env-driven values. How you load env vars (dotenv, your platform's config system, whatever) is up to you — Cascade doesn't care.

### With a connection URI

Cloud-hosted databases usually hand you a single connection URL — MongoDB Atlas gives you `mongodb+srv://...`, every managed Postgres gives you `postgres://...`. Pass it as `uri` and skip host/port/credentials entirely:

```ts
const databaseConfig: ConnectionOptions<MongoDriverOptions, MongoClientOptions> = {
  driver: "mongodb",
  name: "default",
  uri: process.env.DATABASE_URL!,
};
```

Cascade hands the URI to the driver as-is, which is how the underlying client wants it anyway. If both `uri` and `host`/`port` are present, the URI wins.

## Recap

One typed config object describes one data source. One `connectToDatabase()` call wires it up. Run it once at boot.

## Next

Continue to **[Migrations](./04-migrations-intro.md)** to create the tables your models will write into.

## Going further

The config object has more slots than this page mentions — defaults that apply to every model (timestamps, naming conventions, strict mode), driver-specific tuning, multiple data sources, lifecycle knobs. Once you're past the kickoff stage:

- **Tuning model defaults, the configuration hierarchy, driver-specific options, logging:** the [Configuration guide](../architecture-concepts/configuration.md).
- **More than one data source** (multi-tenant, read replicas, separate analytics DB): the [Multi-database guide](../digging-deeper/multi-database.md).
