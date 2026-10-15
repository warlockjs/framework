---
title: "Owner-or-editor policy"
description: Let users edit their own posts, and editors edit any — the canonical ABAC pattern.
sidebar:
  order: 1
  label: "Owner-or-editor"
---

A blog where authors edit their own posts and editors edit anyone's. RBAC grants the *ability*; a policy enforces *ownership*.

## Roles

For a fixed catalog, hand the roles to `DefaultAccessResolver` (a DB-backed app would store the same two rows in the `Role` table):

```ts title="src/config/access.ts"
import { DefaultAccessResolver, type AccessConfigurations } from "@warlock.js/access";

const access: AccessConfigurations = {
  resolver: new DefaultAccessResolver({
    author: ["posts.create", "posts.update"], // can update — but the policy scopes it to their own
    editor: ["posts.*"], //                       can update any post
  }),
};

export default access;
```

Both `author` and `editor` hold `posts.update`. The difference between "own posts" and "any post" is the policy, not the grant.

## The policy

```ts title="src/app/posts/policies/index.ts"
import { definePolicy } from "@warlock.js/access";

definePolicy("posts.update", (user, post, ctx) =>
  post.get("author_id") === user.id || ctx.hasRole("editor"),
);
```

Load it from the posts module's `main.ts` with `import "./policies";` so it registers at boot.

## The route + service

```ts title="src/app/posts/routes.ts"
router.put("/posts/:id", updatePostController, {
  middleware: [authMiddleware([]), gate("posts.update")], // class-level: can they update posts at all?
});
```

```ts title="src/app/posts/services/update-post.service.ts"
import { authorize } from "@warlock.js/access";

export async function updatePost(user: Auth, postId: string, changes: PostChanges) {
  const post = await Post.find(postId);

  // instance-level: the grant passed at the route; now enforce ownership
  await authorize(user, "posts.update", { resource: post });

  return post.merge(changes).save();
}
```

An author editing their own post: grant ✓, policy ✓ → allowed. The same author editing someone else's: grant ✓, policy ✗ → `403`. An editor: grant ✓, policy ✓ (via `hasRole`) → allowed on any post.

## Show the edit button only when allowed

```ts
return {
  ...post.toJSON(),
  canEdit: await can(user, "posts.update", { resource: post }),
};
```

The same decision powers both the server guard and the UI hint — no duplicated logic.
