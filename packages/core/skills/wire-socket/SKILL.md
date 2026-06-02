---
name: wire-socket
description: 'Configure Socket.IO via `src/config/socket.ts`, reach the live server through `getSocketServer()` (or `app.socket` post-bootstrap), register `connection` handlers once the late-phase socket connector has booted, emit from controllers/services, use rooms and namespaces. Triggers: `app.socket`, `getSocketServer`, `SocketOptions`, `socket.io` `Server`, `socket.join`, `socket.to`, `io.of`, `io.use`; "add realtime chat", "emit socket events from a service", "use rooms and namespaces", "per-socket JWT auth". Skip: connector lifecycle — `@warlock.js/core/add-connector/SKILL.md`; app context accessors — `@warlock.js/core/use-app-context/SKILL.md`; competing libs `ws`, `socket.io` direct without Warlock connector, `uWebSockets.js`.'
---

# Warlock — wire a Socket.IO server

Warlock wraps `socket.io`'s `Server` in a connector. That connector is in the **late** lifecycle phase — it boots **after** your app code (every module's `main.ts`, `routes.ts`, `events.ts`) has already been imported. The order is: early-phase connectors (logger, mailer, database, cache, storage) → app code is imported → late-phase connectors (http, then socket) boot. The socket server lives in the framework's DI container once it boots — reach it through `app.socket` or `getSocketServer()`.

The practical consequence: **`app.socket` is not yet populated while a module's `main.ts` is being evaluated at import time.** Register connection handlers from code that runs *after* bootstrap completes — a controller, a service, a job — or guard with `getSocketServer()`. (Unlike the router, which collects routes into a standalone registry that the http connector scans on boot, the socket connector does not harvest listeners registered at import time — it just constructs the `Server`.)

## The shape

```ts title="src/config/socket.ts"
import type { SocketOptions } from "@warlock.js/core";

const socketOptions: SocketOptions = {
  options: {
    cors: { origin: "*" },
  },
};

export default socketOptions;
```

Config the server in `src/config/socket.ts`, then attach handlers once the server is live:

```ts title="src/app/chat/setup-chat-socket.ts — called after bootstrap, or guarded"
import { getSocketServer } from "@warlock.js/core";

export function setupChatSocket() {
  const io = getSocketServer();
  if (!io) return; // socket connector hasn't booted yet

  io.on("connection", (socket) => {
    socket.on("message", (payload) => {
      socket.broadcast.emit("message", payload);
    });
  });
}
```

The framework auto-loads each module's `main.ts` once at boot, but **before** the socket connector starts — so don't read `app.socket` at the top level of `main.ts`.

## Configuration — `src/config/socket.ts`

```ts
export type SocketOptions = {
  port?: number;     // standalone port (only if HTTP is disabled)
  options?: ServerOptions;  // forwarded as the 2nd arg to socket.io's `new Server(httpServer, options)`
};
```

Default: socket.io is mounted on the same HTTP server Warlock boots — no separate port. Set `port` only if you want a dedicated socket server (the connector then creates its own HTTP/HTTPS server and listens on that port).

The `options` block is forwarded verbatim as the second argument to socket.io's `new Server(server, options)`, so it accepts the Socket.IO `ServerOptions` — CORS, transports, pingInterval, path, etc. Common shape:

```ts
const socketOptions: SocketOptions = {
  options: {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
  },
};
```

## Reaching the server — `app.socket` vs `getSocketServer()`

Two ways to get the `socket.io` `Server` instance:

```ts
// 1. Via the app runtime accessor — reads container.get("socket")
import { app } from "@warlock.js/core";

const io = app.socket;            // → Server, or undefined before the socket connector boots

// 2. Via the safe getter — explicit null when the connector hasn't started
import { getSocketServer } from "@warlock.js/core";

const io = getSocketServer();     // → Server | null
```

Both read the same DI container slot. `app.socket` is a getter that returns `container.get("socket")` — that's `undefined` (it does **not** throw) until the socket connector has booted. `getSocketServer()` checks `container.has("socket")` and returns `null` if absent. Prefer `getSocketServer()` plus a null-guard at any call site that *might* run before the connector boots (module-load code, `main.ts` top level, scripts that skip bootstrap). From a controller, a service, a job — anything downstream of a completed bootstrap — `app.socket` is populated and safe to read directly.

## Wiring `connection` handlers

The socket connector boots *after* app code is imported, and it does not collect listeners registered at `main.ts` import time. So register handlers from a function that runs once the server is live — call it from post-bootstrap code, or guard it:

```ts title="src/app/chat/setup-chat-socket.ts"
import { getSocketServer } from "@warlock.js/core";

export function setupChatSocket() {
  const io = getSocketServer();
  if (!io) return; // not booted yet — nothing to attach to

  io.on("connection", (socket) => {
    console.log("client connected", socket.id);

    socket.on("disconnect", () => {
      console.log("client disconnected", socket.id);
    });
  });
}
```

Reading `app.socket` (or `getSocketServer()`) at the top level of `main.ts` returns nothing useful — the server isn't constructed yet. Defer the read to runtime.

## Emitting from a controller or service

Once the server is up, anything with access to `app.socket` can emit:

```ts title="src/app/notifications/services/notify-user.service.ts"
import { app } from "@warlock.js/core";
import type { User } from "app/users/models/user";

export async function notifyUserService(user: User, payload: unknown) {
  app.socket.to(`user:${user.id}`).emit("notification", payload);
}
```

Then from a controller:

```ts
import type { GuardedRequestHandler } from "app/auth/types/guarded-request.type";
import { notifyUserService } from "../services/notify-user.service";

export const sendNotificationController: GuardedRequestHandler = async (request, response) => {
  await notifyUserService(request.user, request.input("payload"));
  return response.success({ delivered: true });
};
```

The HTTP request handles the write side; the socket emit handles the realtime fan-out. Same pattern works for messages, status changes, presence updates.

## Rooms

Rooms are socket.io's per-connection labels — emit to a room and every socket joined to it receives the event:

```ts
io.on("connection", (socket) => {
  socket.on("subscribe", async (channelId: string) => {
    socket.join(`channel:${channelId}`);
  });

  socket.on("unsubscribe", async (channelId: string) => {
    socket.leave(`channel:${channelId}`);
  });
});

// From anywhere with `io`:
io.to(`channel:42`).emit("message", { text: "…" });
```

Typical room-key conventions: `user:<id>`, `channel:<id>`, `org:<id>`. Join on connection (often after auth), leave on disconnect or explicit unsubscribe.

## Namespaces

For larger apps, split socket surfaces into namespaces — each is an isolated event channel. Reach the live server first, then carve the namespace off it:

```ts title="src/app/chat/setup-chat-socket.ts"
import { getSocketServer } from "@warlock.js/core";

export function setupChatSocket() {
  const io = getSocketServer();
  if (!io) return;

  const chat = io.of("/chat");

  chat.on("connection", (socket) => {
    socket.on("message", (payload) => {
      chat.emit("message", payload);
    });
  });
}
```

Client connects to the namespace explicitly: `io("https://your-host/chat")`. Use one namespace per feature when the event sets diverge (chat vs notifications vs presence vs admin).

## Per-socket auth

Hand the socket the JWT (or session token) at the handshake; verify in middleware before any `connection` handler runs. Register the middleware on the live server, same as handlers:

```ts
import { authService } from "@warlock.js/auth";
import { getSocketServer } from "@warlock.js/core";

export function setupAuthedSocket() {
  const io = getSocketServer();
  if (!io) return;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;

      if (!token) {
        return next(new Error("missing-token"));
      }

      const user = await authService.verifyAccessToken(token);

      if (!user) {
        return next(new Error("invalid-token"));
      }

      (socket.data as { user: typeof user }).user = user;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on("connection", (socket) => {
    const user = (socket.data as { user: User }).user;

    socket.join(`user:${user.id}`);
  });
}
```

Socket middleware runs once at handshake — if it errors, the connection is rejected and `connection` never fires. Verify exact auth API against `@warlock.js/auth` source; the example above uses the typical token-verification flow.

## Common patterns

### Broadcast a model update to a room

```ts title="src/app/messages/services/post-message.service.ts"
import { app } from "@warlock.js/core";
import { Message } from "../models/message";

export async function postMessageService(input: { channel_id: string; body: string; user: User }) {
  const message = await Message.create({
    channel_id: input.channel_id,
    body: input.body,
    author_id: input.user.id,
  });

  app.socket.to(`channel:${input.channel_id}`).emit("message:new", message.toJSON());

  return message;
}
```

### Typed event payloads

Socket.IO supports typed events via generic parameters on `Server`:

```ts
import type { Server } from "socket.io";

type ClientToServer = {
  subscribe: (channelId: string) => void;
  message: (payload: { channelId: string; body: string }) => void;
};

type ServerToClient = {
  "message:new": (message: { id: string; body: string }) => void;
};

const io = app.socket as Server<ClientToServer, ServerToClient>;
```

You're casting because the framework exposes a non-generic `Server`. Cast once at the call site and you get typed `emit` / `on` for that scope.

### Emit from outside a request

CLI commands, scheduled jobs, queue workers — anything running outside an HTTP request — still reaches `app.socket` the same way. As long as the socket connector booted, the accessor is live.

## Gotchas

- **`app.socket` is `undefined` before the connector starts — it does not throw.** Because socket is a *late*-phase connector, this includes the top level of `main.ts` (imported before late connectors boot). Reading `app.socket.on(...)` there throws a `TypeError` on `undefined`, not a helpful framework error. Safe in controllers, services, jobs, and any post-bootstrap code; use `getSocketServer()` + a null-guard everywhere else.
- **Register handlers from post-bootstrap code, not at `main.ts` import time.** The socket connector constructs the `Server` but doesn't harvest listeners you registered at import time (unlike routes, which the http connector scans on boot). Wire handlers from a setup function invoked after bootstrap, or guard the registration with `getSocketServer()`.
- **Re-registration can double-bind.** If a setup function runs more than once (HMR, repeated calls), `io.on("connection", ...)` stacks handlers — guard with an idempotency flag if you observe duplicates.
- **CORS matters.** Browsers fail Socket.IO connections silently if CORS rejects the upgrade request. Set `options.cors.origin` to the deployed frontend's origin in production.
- **Rooms are per-socket-instance.** A user logged in from two devices has two sockets. Joining `user:<id>` from both is what makes `app.socket.to("user:42").emit(...)` reach both devices.
- **`io.emit(...)` broadcasts to every connected socket.** Use `to(room).emit(...)` unless that's actually what you want.
- **Don't keep handlers stateful.** Socket events come in any order; treat each as idempotent or guard with a transaction. Stateful in-memory accumulators die with the process and don't survive horizontal scale.

## See also

- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — `app.socket` runtime accessor + `Application` static metadata.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — how connectors order their boot sequence around your modules.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — where socket-related code lives (a setup function for handler registration, `services/` for emit sites).
