---
name: define-relations
description: 'Define and query relations — `@BelongsTo` / `@HasMany` / `@BelongsToMany`, `.with("relation")` eager loading, `.whereHas(relation, cb)` filter-by-related, `setRelation` on save, `.joinWith` for SQL joins, `loadRelation`, `lazy(() => Model)`. Triggers: `@BelongsTo`, `@HasMany`, `@BelongsToMany`, `.with`, `.whereHas`, `setRelation`, `.joinWith`, `lazy`; "define a relation", "avoid N+1", "eager load posts", "filter parents by child"; typical import `import { BelongsTo, HasMany, BelongsToMany } from "@warlock.js/cascade"`. Skip: model basics — `@warlock.js/cascade/define-model/SKILL.md`; competing libs `mongoose populate`, `prisma include`, `typeorm relations`.'
---

# Define and query relations

Relations are decorators on model fields. Cascade's global registry (populated by `@RegisterModel()`) lets each relation look up its peer by name — so `@BelongsTo("User")` finds the `User` class without an import (which avoids circular-dep hell when two models reference each other).

## Three core relation types

### `@BelongsTo(target)` — the foreign-key side

```ts
import { BelongsTo, Model, RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class Post extends Model<PostSchema> {
  public static table = "posts";
  public static schema = postSchema;

  @BelongsTo("User", { foreignKey: "author_id" })
  public author!: User;
}
```

`Post.belongs_to(User)`. The `author_id` column lives on `posts`. Pass the model name (string) for late-bound lookup, or a `lazy(() => User)` thunk if you need explicit type checking. `lazy` comes from `@mongez/reinforcements` (`import { lazy } from "@mongez/reinforcements"`), not from cascade.

### `@HasMany(target)` — the inverse, one-to-many

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;

  @HasMany("Post", { foreignKey: "author_id" })
  public posts!: Post[];
}
```

`User.has_many(Post)`. Same `author_id` column on `posts` — the relation is described from both ends so eager loading and filtering work in both directions.

### `@BelongsToMany(target, options)` — many-to-many via a pivot

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  // ...

  @BelongsToMany("Role", {
    pivot: "user_roles",
    localKey: "user_id",   // pivot column → this model (User)
    foreignKey: "role_id", // pivot column → the related model (Role)
  })
  public roles!: Role[];
}
```

`User.belongs_to_many(Role)` via the `user_roles` pivot table with `user_id` + `role_id`. The pivot's two columns are `localKey` (this model's FK) and `foreignKey` (the related model's FK) — there is no `relatedKey` option. Both sides of the many-to-many declare the relation (symmetric).

#### Pivot operations

Manage pivot rows through `model.pivot(relation)`, which returns the relation's `PivotOperations` handle:

```ts
await user.pivot("roles").attach([adminId, editorId]);             // add (skips existing)
await user.pivot("roles").attach([adminId], { addedBy: actorId }); // + extra pivot columns
await user.pivot("roles").detach([editorId]);                      // remove a subset
await user.pivot("roles").detach();                                // remove all
await user.pivot("roles").sync([adminId]);                         // replace the whole set
await user.pivot("roles").toggle([adminId]);                       // flip each id
```

`model.attach(relation, ids, pivotData?)` and `model.detach(relation, ids?)` are thin shortcuts for the two most common ops; `.sync()` / `.toggle()` live only on the `pivot(relation)` handle (or the standalone `createPivotOperations(model, relation)`). Passing a non-`belongsToMany` relation throws. Routing through `model.pivot(relation)` keeps the join-table `.sync()` distinct from `Model.sync(Target, field)` (the denormalization-embed feature). Pivot ops run direct driver writes — no model lifecycle events fire on the related model.

## Eager loading — `.with(relation)`

Load related models in the same query, avoiding N+1:

```ts
const posts = await Post.with("author").get();

for (const post of posts) {
  post.getRelation("author");   // already loaded — no second query
}
```

Multiple relations:

```ts
await User.with("posts", "roles").get();
```

Nested relations via dot:

```ts
await User.with("posts.comments").get();
// Loads users → their posts → comments for each post — all in 3 queries, not N²
```

## Filtering by related conditions — `.whereHas`

Filter parents based on conditions on children:

```ts
const usersWithPublishedPosts = await User
  .whereHas("posts", (query) => {
    query.where("status", "published");
  })
  .get();
```

`.whereHas(relation, callback)` runs the callback on a query builder scoped to the related model. Use when "find Xs that have at least one Y matching Z."

## Setting a relation on save — `setRelation`

When you persist a model that ALSO needs to wire a relation slot at the same time, use `setRelation` — NOT `.set()`:

```ts
const post = new Post();
post.merge({ title: "Hello", body: "..." });
post.setRelation("author", currentUser);
await post.save();
```

Why not `post.set("author", currentUser)`? `set` treats the value as a column write — for a relation slot, you'd be writing the User instance into a column. `setRelation` knows it's a relation, picks the right foreign-key column, and stores the ID.

## Reading loaded relations

```ts
const post = await Post.with("author").first();

post.getRelation("author");     // typed access to the loaded User
post.author;                    // direct field — only if you declared it as a typed field

// Without eager loading — load on demand, then read:
await post.load("author");
const author = post.getRelation("author");
```

`getRelation("name")` returns the loaded relation (or null if not loaded). `post.load("relation", ...)` lazy-loads one or more relations onto the instance and returns the model (`this`) — read the value back with `getRelation` afterward. Useful when you didn't `.with()` upfront and need a relation conditionally.

## Joins — when eager loading isn't enough

`.with()` runs separate queries and hydrates relations. `.joinWith()` joins at the SQL/aggregation level:

```ts
const result = await User
  .joinWith("posts")
  .where("posts.status", "published")
  .get();
```

Use `.joinWith` when you need conditions across both tables in a single query. Use `.with` when you want hydrated relation models without joining.

## Sync — embedded relations stay fresh

For embedded/denormalized relations (cached `author_name` on posts, etc.), Cascade's sync system keeps the embedded copy in step with the source-of-truth via `Model.sync(Target, field)` and the `@warlock.js/cascade` sync helpers.

## Things NOT to do

- Don't `post.set("author", user)`. Use `setRelation("author", user)`. `set` treats the value as a column write; `setRelation` picks the right foreign key.
- Don't load all parents and iterate to fetch each child — that's the N+1 problem. Eager-load with `.with(...)` (or load specific children with `.load(...)` after the parent fetch).
- Don't define a relation on only one side. Both ends of `BelongsTo`/`HasMany` and both sides of `BelongsToMany` need the decorator for queries to work bidirectionally.
- Don't import the related class for `@BelongsTo` if it would create a circular dependency. Use the string form (`@BelongsTo("User")`) or `lazy(() => User)`.

## See also

- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — `.whereHas` and other filters
- [`@warlock.js/cascade/define-model/SKILL.md`](@warlock.js/cascade/define-model/SKILL.md) — `@RegisterModel`, the registry that makes name-based lookup work
