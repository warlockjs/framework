---
title: "MongoDB replica set for local dev"
sidebar:
  order: 6
  label: "MongoDB replica set for local dev"
---

MongoDB transactions require a **replica set** — a single-node `mongod` running with `--replSet` and one `rs.initiate()` call is enough. Plain `mongod --dbpath /data/db` won't work; the moment your code calls `transaction()`, the driver errors out with *"Transaction numbers are only allowed on a replica set member or mongos"*.

This recipe shows the cheapest way to get transactions working in local development. Production replica sets are a different story — multiple nodes, primary election, oplog sizing — and out of scope here.

## Docker Compose — the easiest path

A single-node replica set on Docker, ready in 30 seconds:

```yaml
# docker-compose.yml
services:
  mongo:
    image: mongo:7
    container_name: mongo-dev
    restart: unless-stopped
    ports:
      - "27017:27017"
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
    healthcheck:
      test: |
        mongosh --quiet --eval '
          try { rs.status().ok } catch(e) { rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]}).ok }
        '
      interval: 5s
      timeout: 10s
      retries: 10
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

Two things make this work:

- **`--replSet rs0`** — starts `mongod` as a replica-set member named `rs0` (any name; `rs0` is conventional).
- **The healthcheck's `rs.initiate(...)`** — runs once on first boot to mark this node as the primary. Subsequent reboots see `rs.status().ok` and skip re-initiation. Idempotent.

Bring it up:

```bash
docker compose up -d mongo
```

Wait for the healthcheck to pass (`docker compose ps mongo` shows `(healthy)`), and the replica set is ready.

## Cascade connection string

Point Cascade at the replica set with the `?replicaSet=` URI parameter:

```ts
await connectToDatabase({
  driver: "mongodb",
  database: "myapp",
  uri: "mongodb://localhost:27017/myapp?replicaSet=rs0&directConnection=true",
});
```

Two flags worth knowing:

- **`replicaSet=rs0`** — tells the driver this is a replica set.
- **`directConnection=true`** — skip the driver's "discover other nodes" step. Required for single-node replica sets because there are no other nodes to discover, and without it the driver hangs.

After this, `transaction(...)` from Cascade works exactly as documented in the [Transactions guide](../digging-deeper/transactions.md).

## Without Docker — bare `mongod`

If you'd rather run `mongod` directly:

```bash
mkdir -p /tmp/mongo-data
mongod --replSet rs0 --dbpath /tmp/mongo-data --bind_ip localhost --port 27017
```

Then in a second terminal, run `rs.initiate()` once:

```bash
mongosh --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})'
```

Same `directConnection=true` URI works. The state is saved under `--dbpath`, so subsequent `mongod` boots come up as the primary automatically — no need to re-initiate.

## Testing it works

A quick smoke test:

```ts
import { transaction } from "@warlock.js/cascade";
import { User } from "app/users/models/user/user.model";

async function smokeTest() {
  await transaction(async () => {
    await User.create({ name: "Test", email: "test@example.com" });
  });
}
```

If you see no error, transactions are working. If you see *"Transaction numbers are only allowed on a replica set member"*, the replica set isn't initiated — re-run `rs.initiate(...)` or check the Docker healthcheck.

## Production replica sets

Production replica sets are three nodes or more, primary election handled by the cluster, real `priority` / `votes` config per node. Atlas handles this for you; self-hosted clusters need a proper deployment playbook (out of scope here).

The single-node local pattern in this recipe is for **development only** — it gives you transaction semantics with one mongod process, but it's not durable or highly available.

## Going further

- **Transactions in Cascade** — [Transactions guide](../digging-deeper/transactions.md)
- **Production MongoDB hosting** — Atlas (`atlas` CLI) or self-hosted with a proper replica-set deployment
- **MongoDB Atlas vector setup** if your local stack also exercises vector search — [Atlas vector setup recipe](./mongodb-atlas-vector-setup.md)
