# Cascade integration tests

The suites under `postgres/` and `mongodb/` run against a real database. They get one in one of two ways.

## Default: testcontainers

With no environment set, `startPostgresHarness()` and `startMongodbHarness()` start a throwaway container
(`postgres:16-alpine`, `mongo:7`) and stop it on teardown. This needs a working Docker daemon.

## Existing database from the environment

When the variables below are set, the same two harness functions skip the container start-up and connect to the server
you name. Every suite that uses them (CRUD, relations, migrations, sync, query, ...) then runs against that server, so a
live run needs one long-lived database container (or a local server) and no testcontainers.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `LOCAL_PG_DATABASE` | PostgreSQL suites | Database to use. Must already exist; the harness never creates or drops databases. |
| `LOCAL_PG_USER` | PostgreSQL suites | User name. |
| `LOCAL_PG_PASSWORD` | PostgreSQL suites | Password (required when the two above are set). |
| `LOCAL_PG_HOST` | PostgreSQL suites | Host. Default `127.0.0.1`. |
| `LOCAL_PG_PORT` | PostgreSQL suites | Port. Default `5432`. |
| `LOCAL_MONGO_URI` | MongoDB suites | Connection string, e.g. `mongodb://127.0.0.1:27017`. The driver connects directly (no replica-set discovery). |
| `LOCAL_MONGO_DATABASE` | MongoDB suites | Database to use. |

The PostgreSQL switch is on when `LOCAL_PG_DATABASE` and `LOCAL_PG_USER` are both set; the MongoDB switch when
`LOCAL_MONGO_URI` and `LOCAL_MONGO_DATABASE` are both set. The two are independent.

Rules for the shared database:

- Point it at a dedicated throwaway database. Suites create their own tables and collections and drop only the ones
  they created; they do not isolate themselves from other data in the same database.
- Teardown only disconnects. The server is never stopped or reset.
- MongoDB features that need a replica set (multi-document transactions) need `LOCAL_MONGO_URI` to point at a
  single-node replica set.

Example (one PostgreSQL container on the host network, then the suites):

```bash
export LOCAL_PG_DATABASE=cascade_test LOCAL_PG_USER=cascade LOCAL_PG_PASSWORD=cascade LOCAL_PG_PORT=5433
cd packages/cascade && npx vitest run tests/integration/postgres
```
