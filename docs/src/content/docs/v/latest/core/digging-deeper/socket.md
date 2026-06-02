---
title: "Sockets"
description: Real-time over Socket.IO — the connector that boots the server, the src/config/socket.ts shape, and getSocketServer() for emitting from anywhere in your app.
sidebar:
  order: 10
  label: "Sockets"
---

Warlock ships a Socket.IO connector. When `src/config/socket.ts` exists, the framework starts a Socket.IO server next to your HTTP server, parks the instance in the DI container, and hands you a one-liner to grab it from any controller, service, or use-case. From there you're using vanilla `socket.io` — rooms, namespaces, middleware, all of it.

That's the honest scope today. The framework owns the lifecycle (boot, watch the config for changes, shut down cleanly). What you build on top — auth handshakes, per-user rooms, broadcast helpers — is plain Socket.IO code in your modules. We'll show the patterns that fit cleanly; deeper integrations (per-socket auth resolution, a typed event bus, automatic room joining for logged-in users) are roadmapped, not shipped.

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

**The port story matters.** If your project has `src/config/http.ts` (which most do), the socket connector reuses the Fastify HTTP server — no separate port, no second listener. If HTTP is disabled, the connector spins up its own raw HTTP server on `socketConfig.port`. SSL works the same way: with HTTP enabled, you inherit its SSL setup; without HTTP, set `ssl` in the config and the connector creates an HTTPS server instead.

**Editing the config restarts the connector.** The socket connector watches `src/config/socket.ts`. Save the file with new CORS rules, the dev server tears down the existing Socket.IO server and boots a fresh one with the new options — open sockets disconnect, clients reconnect.

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
- **HMR drops sockets.** The dev server tears down and recreates the Socket.IO server when `src/config/socket.ts` changes. Clients reconnect, but any in-flight ack callbacks are gone. Don't rely on long-lived connections in dev.
- **Listener registration leaks.** Adding `io.on("connection", …)` at the top of a hot-reloaded file means each save piles on another listener. Always register in `main.ts` (which is auto-loaded once per boot, not per module re-import) — or guard with `onCleanup` to remove the listener on reload.
- **The connector is `Late` phase.** It boots after app code has loaded, so trying to grab `getSocketServer()` at module top-level — outside `main.ts` or a function body — gets you `null`. Wrap socket access in functions called at request time or in `main.ts`.
- **Auth is on you.** Socket.IO has no notion of "logged-in user" out of the box. The framework's auth helpers run on HTTP requests. Wire a `io.use(middleware)` that reads the handshake token if you need per-socket user resolution.

## Going further

- [Socket.IO Server API](https://socket.io/docs/v4/server-api/) — the surface you're working with under `getSocketServer()`. Rooms, namespaces, middleware, adapters.
- [`guides/bootstrap-and-connectors.md`](../architecture-concepts/bootstrap-and-connectors.md) — connector lifecycle, `Early` vs `Late` phase, and how the socket connector fits.
- [`guides/warlock-config.md`](../architecture-concepts/warlock-config.md) — the project-level config layer (sockets live in `src/config/socket.ts`, not in `warlock.config.ts`).
