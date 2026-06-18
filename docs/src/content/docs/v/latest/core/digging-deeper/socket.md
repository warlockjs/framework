---
title: "Sockets"
description: Real-time over Socket.IO — the connector that boots the server, the src/config/socket.ts shape, and getSocketServer() for emitting from anywhere in your app.
sidebar:
  order: 10
  label: "Sockets"
---

Warlock ships a Socket.IO connector. When `src/config/socket.ts` exists, the framework starts a Socket.IO server next to your HTTP server, parks the instance in the DI container, and hands you a one-liner to grab it from any controller, service, or use-case. From there you're using vanilla `socket.io` — rooms, namespaces, middleware, all of it.

That's the honest scope today. The framework ships only the **server** side. The framework owns the lifecycle (boot, watch the config for changes, shut down cleanly). What you build on top — auth handshakes, per-user rooms, broadcast helpers — is plain Socket.IO code in your modules. The client side is plain `socket.io-client` (see [Connecting a client](#connecting-a-client)). We'll show the patterns that fit cleanly; deeper integrations (per-socket auth resolution, a typed event bus, automatic room joining for logged-in users) are roadmapped, not shipped.

**`socket.io` is an optional peer.** The framework does not depend on it directly — the connector lazy-imports it on boot. If you add `src/config/socket.ts` without `socket.io` installed, the connector throws on startup with install instructions. Run `warlock add socket` to install the dependency and eject a starter config.

## When you reach for it

The HTTP side of Warlock covers request/response. Sockets cover the cases HTTP can't:

- **Push to the client.** Order status changes, new chat messages, agent progress updates.
- **Subscribe to live data.** Dashboard widgets, presence indicators, collaborative editing.
- **Low-latency two-way.** Anything where a poll loop would be silly.

If your need is "the user clicks a button and gets a reply," HTTP is fine. If your need is "the server has something new to say without being asked," that's socket territory.

## The 30-second look

```ts title="src/config/socket.ts"
import type { SocketOptions } from "@warlock.js/core";

export default {
  options: {
    cors: {
      origin: "*",
    },
  },
} as SocketOptions;
```

```ts title="src/app/orders/main.ts"
import { getSocketServer } from "@warlock.js/core";

const io = getSocketServer();

if (io) {
  io.on("connection", (socket) => {
    socket.on("join-order-room", (orderId: string) => {
      socket.join(`order:${orderId}`);
    });
  });
}
```

```ts title="src/app/orders/services/notify-status-change.service.ts"
import { getSocketServer } from "@warlock.js/core";

export async function notifyStatusChange(orderId: string, status: string) {
  const io = getSocketServer();

  if (!io) {
    return;
  }

  io.to(`order:${orderId}`).emit("status-changed", { status });
}
```

Three pieces — config file, listener registration in a module's `main.ts`, and `getSocketServer()` for emitting from anywhere. That's the whole surface today.

## Configuration — `src/config/socket.ts`

The presence of the config file is the switch. No `src/config/socket.ts`, no Socket.IO server. Add the file, restart the dev server, and you're live.

```ts title="src/config/socket.ts"
import type { SocketOptions } from "@warlock.js/core";

export default {
  port: 3001,
  options: {
    cors: {
      origin: "*",
      credentials: true,
    },
    transports: ["websocket", "polling"],
  },
} as SocketOptions;
```

| Field     | Type                            | When you need it                                                                 |
| --------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `port`    | `number`                        | Only when HTTP is disabled. With HTTP on, Socket.IO attaches to the same server. |
| `options` | Socket.IO `ServerOptions`       | Anything the [Socket.IO docs](https://socket.io/docs/v4/server-options/) lists — `cors`, `path`, `pingInterval`, `transports`, `maxHttpBufferSize`, etc. |

> **Editor autocomplete quirk.** The exported `SocketOptions.options` field is currently typed as Node's `http` `ServerOptions` (a source-side type quirk), so your editor won't autocomplete Socket.IO option names — but they DO take effect at runtime, since the value is passed straight into `new Server(server, options)`.

**The port story matters.** If your project has `src/config/http.ts` (which most do), the socket connector reuses the Fastify HTTP server — no separate port, no second listener. If HTTP is disabled, the connector spins up its own raw HTTP server on the config's `port`. SSL follows the same path: with HTTP enabled, you inherit its SSL setup; without HTTP, the connector creates an HTTPS server instead of an HTTP one when an `ssl` flag is truthy on the config.

> **`ssl` is read but not yet on the type.** The connector reads `socketConfig.ssl` at runtime to decide HTTP vs HTTPS, but the exported `SocketOptions` type only declares `port?` and `options?`. Setting `ssl: true` against `as SocketOptions` is a type error today. If you need the standalone HTTPS path, drop the `as SocketOptions` annotation (or cast through `as any`) until the field lands on the type. With HTTP enabled this never matters — SSL is inherited from the Fastify server.

**Editing the config tears the server down — but does *not* hot-apply new options.** The socket connector watches `src/config/socket.ts`. On a change, the dev server calls the connector's `restart()`, which runs `shutdown()` then `start()`. Here's the catch: the Socket.IO server is built in `boot()`, and `restart()` never calls `boot()`. So saving the config disconnects open sockets and shuts the old server down, but a fresh server with your new options is **not** stood back up until a full dev-server restart. This is a current limitation — restart the dev server to apply config changes.

## Registering listeners — `main.ts`

The right place to wire `io.on("connection", …)` is your module's `main.ts`. The framework auto-loads `main.ts` once per module at boot, after connectors are up. The socket instance is ready by then.

```ts title="src/app/chats/main.ts"
import { getSocketServer } from "@warlock.js/core";

const io = getSocketServer();

if (!io) {
  // Socket config is disabled in this environment — no-op.
  return;
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("join-conversation", (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
  });

  socket.on("leave-conversation", (conversationId: string) => {
    socket.leave(`conversation:${conversationId}`);
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});
```

The null check matters — sockets are opt-in, so `getSocketServer()` returns `null` when there's no config. Tests, prod environments without realtime, and the early bootstrap phase all see `null`. Guard once at the top of `main.ts` and you can use `io` without `!`-asserting it.

## `getSocketServer()` — the lookup

Inside any service, controller, or use-case, grab the singleton:

```ts
import { getSocketServer } from "@warlock.js/core";

const io = getSocketServer(); // Server | null
```

The return type is the Socket.IO `Server` from the `socket.io` package. Everything that library does, you have. Rooms, namespaces, middleware:

```ts
const io = getSocketServer();

if (!io) {
  return;
}

// Emit to one socket
io.to(socketId).emit("event-name", payload);

// Emit to a room
io.to("admins").emit("alert", { message: "All hands" });

// Broadcast to everyone
io.emit("server-shutdown", { at: Date.now() });

// Get a namespace
const adminIo = io.of("/admin");

// Apply middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  // …verify token, attach user, call next() or next(new Error(...))
  next();
});
```

The container guarantees you get the same instance on every call — `getSocketServer()` is just a `container.get("socket")` underneath.

## Connecting a client

The framework ships **only the server**. There is no bundled client — connect from the browser (or a Node service, or React Native) with the standard `socket.io-client` package, which you install in the *client* project yourself.

```ts title="client-side (browser)"
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  // The handshake auth payload your server reads via socket.handshake.auth
  auth: {
    token: localStorage.getItem("token"),
  },
});

socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("join-conversation", "abc123");
});

socket.on("status-changed", (payload) => {
  console.log("status changed", payload);
});
```

The `auth` object is what surfaces server-side as `socket.handshake.auth` — the same value an `io.use((socket, next) => …)` middleware reads to authenticate the connection (see the [per-user rooms](#per-user-rooms-after-auth) pattern below). Everything else — events, rooms, reconnection — is plain Socket.IO; the [client docs](https://socket.io/docs/v4/client-api/) apply unchanged.

**Raw-server access (advanced).** When the connector builds the Socket.IO server it also stores the underlying Node HTTP/HTTPS server under the container key `socket.rawServer`. You rarely need it — `getSocketServer()` covers normal use — but it's there if you must reach the raw listener (for example to attach a second protocol to the same port):

```ts
import { container } from "@warlock.js/core";

if (container.has("socket.rawServer")) {
  const rawServer = container.get("socket.rawServer");
  // rawServer is the Node http.Server / https.Server backing Socket.IO
}
```

Note: `socket.rawServer` is a runtime-only container key — it is not declared on the typed `ContainerTypes` map, so `container.get("socket.rawServer")` resolves through the generic string overload.

## Common patterns

### Emit from a service after a Cascade save

```ts title="src/app/orders/services/update-order-status.service.ts"
import { getSocketServer } from "@warlock.js/core";
import { Order } from "../models/order";

export async function updateOrderStatus(orderId: string, status: string) {
  const order = await Order.find(orderId);

  if (!order) {
    return null;
  }

  order.set("status", status);
  await order.save();

  const io = getSocketServer();

  if (io) {
    io.to(`order:${orderId}`).emit("order-status-changed", {
      orderId,
      status,
      updatedAt: new Date(),
    });
  }

  return order;
}
```

The service does the database work first, then notifies. If the save fails, no event fires — the client never sees stale state.

### Per-user rooms after auth

A common pattern: the moment a socket authenticates, join it to a personal room so other code can `io.to("user:123").emit(...)` without tracking socket IDs.

```ts title="src/app/users/main.ts"
import { getSocketServer } from "@warlock.js/core";
import { verifyJWT } from "app/auth/services/verify-jwt";

const io = getSocketServer();

if (!io) {
  return;
}

io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    socket.disconnect();
    return;
  }

  try {
    const user = await verifyJWT(token);
    socket.join(`user:${user.id}`);
    socket.data.user = user;
  } catch {
    socket.disconnect();
  }
});
```

Note: this is **plain Socket.IO**. The framework doesn't currently wire JWT verification into the socket handshake automatically — you write the middleware. If you want it pulled into a connector option later, that's a roadmap item, not a current feature.

### Broadcast from a use-case `after` hook

```ts
import { getSocketServer, useCase } from "@warlock.js/core";

export const placeOrder = useCase<Order, PlaceOrderInput>({
  name: "place_order",
  schema: placeOrderSchema,
  handler: async (input, ctx) => {
    return placeOrderService(input);
  },
  after: [
    async (order, ctx) => {
      const io = getSocketServer();

      if (io) {
        io.to(`user:${ctx.userId}`).emit("order-placed", { orderId: order.id });
      }
    },
  ],
});
```

The `after` hook is fire-and-forget — broadcast failures don't fail the use-case. That's usually what you want for notifications.

## Gotchas

- **No socket without config.** `getSocketServer()` returns `null` if `src/config/socket.ts` doesn't exist. Always null-check before emitting; don't litter `!` non-null assertions across services.
- **Editing the socket config needs a full restart.** Saving `src/config/socket.ts` runs the connector's `restart()` (= `shutdown()` + `start()`), which tears the running server down. Because the server is built in `boot()` — and `restart()` never calls `boot()` — a fresh server with your new options does **not** come back up on its own. Restart the dev server to pick up config changes. (Open sockets disconnect on the teardown either way.)
- **Listener registration leaks.** Adding `io.on("connection", …)` at the top of a hot-reloaded file means each save piles on another listener. Always register in `main.ts` (which is auto-loaded once per boot, not per module re-import) — or guard with `onCleanup` to remove the listener on reload.
- **The connector is `Late` phase.** It boots after app code has loaded, so trying to grab `getSocketServer()` at module top-level — outside `main.ts` or a function body — gets you `null`. Wrap socket access in functions called at request time or in `main.ts`.
- **Auth is on you.** Socket.IO has no notion of "logged-in user" out of the box. The framework's auth helpers run on HTTP requests. Wire a `io.use(middleware)` that reads the handshake token if you need per-socket user resolution.

## Going further

- [Socket.IO Server API](https://socket.io/docs/v4/server-api/) — the surface you're working with under `getSocketServer()`. Rooms, namespaces, middleware, adapters.
- [`guides/bootstrap-and-connectors.md`](../architecture-concepts/bootstrap-and-connectors.md) — connector lifecycle, `Early` vs `Late` phase, and how the socket connector fits.
- [`guides/warlock-config.md`](../architecture-concepts/warlock-config.md) — the project-level config layer (sockets live in `src/config/socket.ts`, not in `warlock.config.ts`).
