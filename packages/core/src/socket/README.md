# Socket

## Multiple servers: Redis adapter

Without an adapter, broadcasts only reach clients connected to the same server.
Behind a load balancer, set `socket.adapter`:

```ts
// src/config/socket.ts
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

export default {
  port: 3001,
  adapter: () => {
    const pubClient = new Redis(process.env.REDIS_URL!);
    const subClient = pubClient.duplicate();
    return createAdapter(pubClient, subClient);
  },
};
```

With the `redis` package instead:

```ts
import { createClient } from "redis";

adapter: async () => {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  return createAdapter(pubClient, subClient);
},
```

Install: `npm i @socket.io/redis-adapter ioredis` (or `redis`).

## Sticky sessions

The polling transport sends several requests per session, so the load balancer
must route a client to the same server (IP hash or cookie affinity), or clients
should use `transports: ["websocket"]`. The adapter does not replace this.

## Warning

In production with no adapter, a one-time warning is logged. Set
`silenceSingleServerWarning: true` if you intentionally run a single server.
