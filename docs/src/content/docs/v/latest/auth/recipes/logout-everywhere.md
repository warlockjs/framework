---
title: "Logout everywhere"
description: A one-button "log me out of every device" endpoint.
sidebar:
  order: 1
  label: "Logout everywhere"
---

A controller that revokes every active session for the current user. Useful for the "I lost my phone" button on the account-security page.

```ts title="src/app/users/controllers/logout-everywhere.controller.ts"
import { authService } from "@warlock.js/auth";
import type { Request, Response } from "@warlock.js/core";

export async function logoutEverywhereController(request: Request, response: Response) {
  await authService.revokeAllTokens(request.user!);

  return response.success({ message: "Logged out from every device" });
}
```

Wire it behind required auth:

```ts title="src/app/users/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { logoutEverywhereController } from "./controllers/logout-everywhere.controller";

router.post("/account/logout-everywhere", logoutEverywhereController, {
  middleware: [authMiddleware([])],
});
```

What `revokeAllTokens` does, end to end:

1. Find every non-revoked refresh token for the user.
2. Call `.revoke()` on each (sets `revoked_at = now()`).
3. Fire `token.revoked` per token.
4. Delete every access-token row for the user.
5. Fire `logout.all` once.

After this returns, every other client holding any token for this user gets a 401 on its next request — refresh attempts hit the revoked-token branch and return `null`.

## Confirm with the current password first

If the button isn't behind a recent-login window, gate it with a password confirmation:

```ts
export async function logoutEverywhereController(request: Request, response: Response) {
  const user = request.user!;
  const ok = await user.confirmPassword(request.input("currentPassword"));

  if (!ok) {
    return response.unauthorized({ error: "Wrong password" });
  }

  await authService.revokeAllTokens(user);

  return response.success({ message: "Logged out from every device" });
}
```

`confirmPassword` is the instance-method form of `verifyPassword` against the user's stored hash.

## Related

- [Handle login and logout](../guides/handle-login-and-logout.md) — single-device logout.
- [Manage tokens](../guides/manage-tokens.md) — the full revocation surface.
- [List active sessions](./list-active-sessions.md) — show the user what's about to get revoked.
