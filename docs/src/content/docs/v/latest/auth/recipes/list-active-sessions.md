---
title: "List active sessions"
description: Build a manage-your-sessions endpoint backed by getActiveSessions, with per-session revoke.
sidebar:
  order: 2
  label: "List active sessions"
---

A two-endpoint pattern for the "manage your sessions" screen:

- `GET /account/sessions` — list every active session for the current user.
- `DELETE /account/sessions/:id` — revoke one specific session.

## List

```ts title="src/app/users/controllers/list-sessions.controller.ts"
import { authService } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";

export async function listSessionsController(request: Request, response: Response) {
  const sessions = await authService.getActiveSessions(request.user!);

  return response.success({
    sessions: sessions.map((session) => ({
      id: session.id,
      deviceInfo: session.get("device_info"),
      createdAt: session.get("created_at"),
      expiresAt: session.get("expires_at"),
      lastUsedAt: session.get("last_used_at"),
    })),
  });
}
```

`getActiveSessions` returns the non-revoked, non-expired `RefreshToken` instances for the user, newest first. `device_info` is whatever you passed to `createTokenPair(user, deviceInfo)` at login — typically `{ userAgent, ip, deviceId }`.

The instance-method form is `request.user!.activeSessions()`.

## Revoke one

```ts title="src/app/users/controllers/revoke-session.controller.ts"
import { RefreshToken } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";

export async function revokeSessionController(request: Request, response: Response) {
  const user = request.user!;
  const sessionId = request.input("id");

  const session = await RefreshToken.first({
    id: sessionId,
    user_id: user.id,
    user_type: user.userType,
  });

  if (!session) {
    return response.notFound({ error: "Session not found" });
  }

  await session.revoke();

  return response.success({ message: "Session revoked" });
}
```

Two things worth calling out:

- **Scope the lookup by `user_id` + `user_type`.** Otherwise a user could revoke another user's session by guessing the ID. The framework's `Model.first({...})` filters all the conditions together.
- **`.revoke()` is soft.** The row stays in the table with `revoked_at` stamped — the audit trail survives. The next refresh attempt with that token hits the revoke branch and returns `null`.

## Wire the routes

```ts title="src/app/users/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { listSessionsController } from "./controllers/list-sessions.controller";
import { revokeSessionController } from "./controllers/revoke-session.controller";

router.group({ prefix: "/account/sessions", middleware: [authMiddleware([])] }, () => {
  router.get("/", listSessionsController);
  router.delete("/:id", revokeSessionController);
});
```

## Related

- [Manage tokens](../guides/manage-tokens.md) — `getActiveSessions` + the rest of the revocation surface.
- [Logout everywhere](./logout-everywhere.md) — revoke all sessions at once.
