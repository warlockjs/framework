---
title: "JSON mutations — updating nested fields safely"
sidebar:
  order: 4
  label: "JSON mutations"
---

The [JSON fields guide](../digging-deeper/json-fields.md) covers reading nested data. This recipe covers writing: updating fields inside JSON columns without clobbering siblings, racing concurrent writes, or breaking validation.

## Setting a nested path — `.set` with dot-notation

```ts
const user = await User.find(userId);

user.set("profile.address.city", "London");
await user.save();
```

Cascade walks the path inside `model.data`, creates intermediate objects if missing, and marks the path dirty. Sibling fields under `profile.address` (street, postcode) stay intact on MongoDB; on Postgres the entire `profile` column is rewritten with the new value merged in.

Setting an object replaces the subtree:

```ts
user.set("profile.address", { city: "London", country: "UK" });
```

Now `street` and `postcode` are gone — the address object is whatever you just set.

## Partial updates with `merge`

When you want to update several nested fields at once:

```ts
user.merge({
  profile: {
    address: { city: "London" },
    avatar: "https://...",
  },
});

await user.save();
```

`merge` is a **deep merge**. `profile.address.street` and `profile.address.postcode` keep their old values; only `city` is replaced and `avatar` is added.

Reach for `set` when you want field-level replacement. Reach for `merge` when you want field-level addition.

## Updating an array entry by id

Replacing one item in an array — flip a notification preference, edit a single tag — needs you to find the entry, build the updated array, and write it back:

```ts
const user = await User.find(userId);
const notifications = user.get("preferences.notifications") as Array<{
  id: string;
  enabled: boolean;
}>;

const updated = notifications.map((notification) => {
  if (notification.id !== notificationId) {
    return notification;
  }

  return { ...notification, enabled: false };
});

user.set("preferences.notifications", updated);
await user.save();
```

You can't just mutate `notifications[i].enabled = false`. Cascade's dirty tracking goes through accessor methods — mutating the returned array in place doesn't mark anything dirty, and `save()` thinks the model is clean and skips the write. See the [Dirty tracking guide](../architecture-concepts/dirty-tracking.md) for the full footgun.

## Appending to an array

```ts
const current = (user.get("preferences.notifications") as Array<unknown>) ?? [];

user.set("preferences.notifications", [
  ...current,
  { id: newId, type: "email", enabled: true },
]);

await user.save();
```

Read, build the new array, write the whole thing back. For high-write append loads (chat messages, activity logs), consider splitting the array out into its own table — JSON arrays inside a column fight you at scale.

## Race-safe counters inside JSON

The instance-level `increment("preferences.viewCount")` reads, adds, and saves — the same lost-update race documented in the [Atomic operations guide](../digging-deeper/atomic-operations.md).

For hot counters, the cleanest answer is to **lift the counter into its own column**:

```ts
viewCount: v.number().default(0),
```

Then increment atomically via the query builder:

```ts
await User.whereId(userId).increment("viewCount");
```

Single statement. Race-safe. No JSON manipulation.

## Unsetting a nested field

```ts
user.unset("profile.avatar");
await user.save();
```

On MongoDB this emits `$unset` and the field is physically removed. On Postgres, the JSONB column gets the key removed.

`get("profile.avatar")` returns `undefined` afterwards — distinct from `set("profile.avatar", null)`, which leaves the key present with a null value.

## Validating nested JSON

`v.any()` is permissive. For real safety, structure it:

```ts
const addressSchema = v.object({
  city: v.string(),
  country: v.string(),
  postcode: v.string().optional(),
});

const profileSchema = v.object({
  address: addressSchema.optional(),
  avatar: v.string().optional(),
  bio: v.string().optional(),
});

const userSchema = v.object({
  name: v.string(),
  email: v.email(),
  profile: profileSchema.optional(),
});
```

Now `user.set("profile.address.city", 42)` fails on save — `userSchema.validate(data)` rejects, throws `DatabaseWriterValidationError`, the write is aborted.

Pick based on stability:

- **Stable, app-defined shape** (settings, user profile) — structured validator.
- **User-defined or third-party shape** (webhook payloads, AI tool args) — `v.any()`.

## Putting it together — a settings update service

```ts
import { User } from "../models/user/user.model";

type UpdatePreferencesInput = {
  userId: string;
  preferences: Partial<{
    theme: "light" | "dark";
    notifications: Partial<{
      email: boolean;
      push: boolean;
    }>;
  }>;
};

export async function updatePreferences(input: UpdatePreferencesInput) {
  const user = await User.find(input.userId);

  if (!user) {
    throw new Error("User not found");
  }

  user.merge({ preferences: input.preferences });

  await user.save();

  return user;
}
```

`merge` does a deep merge, so any keys the caller didn't include stay intact. The whole "patch a subset of preferences" story is one line.

## Going further

- **Reading JSON fields** — [JSON fields guide](../digging-deeper/json-fields.md)
- **Why mutation-by-reference doesn't dirty-track** — [Dirty tracking guide](../architecture-concepts/dirty-tracking.md)
- **Atomic counters in regular columns** — [Atomic operations guide](../digging-deeper/atomic-operations.md)
- **Structured validation** — [Validation guide](../the-basics/validation.md)
