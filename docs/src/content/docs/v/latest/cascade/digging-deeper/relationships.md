---
title: "Relationships — the deep guide"
sidebar:
  order: 6
  label: "Relationships (deep dive)"
---

The [Relationships essentials](../the-basics/03-relationships.md) page introduces the four relation types (`hasMany`, `hasOne`, `belongsTo`, `belongsToMany`), how foreign keys are inferred, and how `.with()` loads them eagerly. This guide picks up where that page ends.

We cover, in this order:

- **`belongsToMany`** — the many-to-many shape, its pivot table, and the pivot operations via `model.pivot(relation)` (`attach`/`detach`/`sync`/`toggle`)
- **Lazy loading after the fact** with `model.load(...)`
- **Per-query constraints** on `.with()` — filter, order, limit the related query
- **Polymorphic and self-referential** shapes — what to do and what to watch for
- **Nested eager loading** (`User.with("posts.comments.author")`)
- **Performance** — `.with()` vs `.joinWith()` vs raw joins
- **Common pitfalls** — circular relations, N+1 traps, foreign-key surprises

## `@BelongsToMany` — the many-to-many shape

Many-to-many means: each `Post` can have many `Tag`s, each `Tag` can be attached to many `Post`s. The connection is stored in a third table — the **pivot** — that has one row per (post, tag) pairing.

```ts
// post.model.ts
import { lazy } from "@mongez/reinforcements";
import { BelongsToMany, Model, RegisterModel } from "@warlock.js/cascade";
import { Tag } from "app/tags/models/tag/tag.model";

@RegisterModel()
export class Post extends Model<PostSchema> {
  public static table = "posts";
  public static schema = postSchema;

  @BelongsToMany(lazy(() => Tag))
  public tags?: Tag[];
}

// tag.model.ts
import { lazy } from "@mongez/reinforcements";
import { BelongsToMany, Model, RegisterModel } from "@warlock.js/cascade";
import { Post } from "app/posts/models/post/post.model";

@RegisterModel()
export class Tag extends Model<TagSchema> {
  public static table = "tags";
  public static schema = tagSchema;

  @BelongsToMany(lazy(() => Post))
  public posts?: Post[];
}
```

That's it. Cascade infers everything:

- **Pivot table** — alphabetical snake-join of the two model names. `Post` + `Tag` → `post_tag`. `User` + `Role` → `role_user`. Both sides resolve to the same table, so there's no possibility of one side reading from `post_tag` while the other writes to `tag_post`.
- **Pivot columns** — `<model_snake>_id` on each side. `post_id` and `tag_id` here.

A few properties to internalise:

- **Both sides declare the relation.** `Post.tags` for one direction, `Tag.posts` for the other. The alphabetical-sort convention makes them resolve to the same pivot without coordination.
- **You still write the pivot migration yourself.** Cascade reads/writes it but doesn't manage its schema — declare `post_tag` (or whatever the convention produces) in a migration like any other table, with the two FK columns named according to the convention.
- **Override the convention when you need to.** Legacy schemas, plural pivot names, non-default column names — pass options:

  ```ts
  @BelongsToMany(lazy(() => Tag), {
    pivot: "post_tags",      // override the inferred name
    localKey: "post_id",
    foreignKey: "tag_id",
  })
  public tags?: Tag[];
  ```

### Loading the related models

```ts
const post = await Post.query().with("tags").find(id);
console.log(post.tags); // Tag[]
```

Same `.with(...)` you've already seen. Cascade fetches the pivot rows for this post, then the matching tags in a second query.

### Pivot operations — `model.pivot(relation)`

Every pivot mutation hangs off one accessor, `model.pivot(relation)`:

```ts
await post.pivot("tags").attach([1, 2, 3]);                       // add (skip already-attached)
await post.pivot("tags").attach([4], { addedBy: currentUserId }); // + pivot columns
await post.pivot("tags").detach([2]);                             // remove specific ids
await post.pivot("tags").detach();                                // remove ALL
await post.pivot("tags").sync([1, 3, 5]);                         // replace the whole set
await post.pivot("tags").toggle([1, 7]);                          // flip each
```

- **`.attach(ids, pivotData?)`** — inserts pivot rows for any ids not already attached. Existing attachments are left alone (no duplicates). The optional `pivotData` writes extra columns on the pivot row itself (`addedBy`, `addedAt`, `order`, ...).
- **`.detach(ids?)`** — deletes pivot rows. Pass `ids` to detach a subset; omit them to detach everything.
- **`.sync(ids, pivotData?)`** — makes the pivot match exactly the given set: attaches the missing, detaches the extra. The "replace" operation.
- **`.toggle(ids)`** — for each id, attach if missing or detach if present. Convenient for like/unlike, follow/unfollow, bookmark/unbookmark.

`model.pivot(relation)` returns the pivot-operations object for that `@BelongsToMany` relation; passing a non-`@BelongsToMany` relation (e.g. a `@BelongsTo`) throws.

The `.pivot("tags")` qualifier is deliberate. `model.pivot("tags").sync(...)` is a *pivot* set-replace; `Model.sync(Target, field)` is the unrelated [denormalization-embed feature](./sync.md). Routing every pivot op through `model.pivot(relation)` keeps the two `sync`s from ever colliding in autocomplete or review.

> The standalone `createPivotOperations(model, relation)` is still exported from `@warlock.js/cascade` for code that wants to grab the ops object directly (tests, helpers). `model.pivot(relation)` is the ergonomic front for it — same relationship as `transaction()` to `getDatabaseDriver().transaction()`.

These run direct driver operations against the pivot table — no model lifecycle events fire on `Tag` (because Tag itself isn't being inserted/deleted). If you need events on attachment changes, listen on the `Post` events that *cause* the attachment.

### Extra columns on the pivot

Add columns to your pivot table (e.g., `role`, `order`, `addedAt`) and pass them via the `pivotData` argument:

```ts
await user.pivot("teams").attach([team.id], {
  role: "admin",
  addedAt: new Date(),
});
```

Reading them back is currently a separate query against the pivot table — the pivot row's extra columns aren't automatically merged into the loaded `Tag` / `Team` instances. If you need them, query the pivot table directly.

## Lazy loading — `model.load(...)`

`.with(...)` loads relations as part of the original query. But sometimes you've already fetched the model, and *now* you want to pull in a relation. `load` is the post-hoc version:

```ts
const user = await User.find(id);
// ... a hundred lines later, after some branching logic ...
await user.load("posts", "organization");

console.log(user.posts);         // Post[]
console.log(user.organization);  // Organization | null
```

The model loads its missing relations and attaches them to the instance. Calling `load` for a relation that's already loaded is a no-op (Cascade won't re-fetch unless you tell it to).

Lazy loading is great when:

- The relation is needed only on certain code paths and you don't want to pay for it upfront.
- You've received a model from somewhere else (test fixture, cache, deserialisation) and need to enrich it.
- You're in a controller that has `model.id` and wants the relations attached for the response.

Lazy loading is **bad** when:

- You're inside a loop. `for (const user of users) await user.load("posts")` is the textbook N+1 problem. Use `.with()` on the original query, or `RelationLoader` (covered in the essentials page) to batch.

## Per-query constraints on `.with()`

`.with(...)` accepts a callback to constrain the related query — filter, order, limit, project:

```ts
const user = await User.query()
  .with("posts", q => {
    q.where("isPublished", true)
     .orderBy("createdAt", "desc")
     .limit(5);
  })
  .find(id);
```

Now `user.posts` is *the five most recent published posts*, not every post the user ever wrote. The constraint runs inside the related query, after the foreign-key match.

For multiple relations with different constraints, pass an object:

```ts
const user = await User.query()
  .with({
    posts: q => q.where("isPublished", true),
    organization: true,
    roles: q => q.orderBy("priority"),
  })
  .find(id);
```

`true` means "load with no extra constraint." Mix and match freely.

### Nested constraints

When you nest relations (see "Nested eager loading" below), constraints on the *outer* relation apply at that level — they don't cascade:

```ts
User.query().with("posts", q => q.with("comments")).find(id);
// User → posts (constrained how you'd like) → posts.comments (no constraint)
```

If you want to constrain the inner relation, pass the constraint at that level:

```ts
User.query()
  .with("posts", q => q.with("comments", c => c.where("approved", true)))
  .find(id);
```

## Nested eager loading

Dot-paths in `.with()` walk down relations:

```ts
const user = await User.query().with("posts.comments.author").find(id);
// user.posts                   → Post[]
// user.posts[i].comments       → Comment[]
// user.posts[i].comments[j].author → User
```

Cascade resolves each segment in turn — load posts, load comments for those posts, load authors for those comments. Each segment is a single batched query, so the total cost is `1 + N_paths` queries, not `1 + N × M × K`.

Same shape works with constraints:

```ts
User.query()
  .with({
    "posts.comments": q => q.where("approved", true),
  })
  .find(id);
```

## Self-referential relations

A model can relate to itself — common patterns include a `Category.parent`, a `User.manager`, or a `Comment.replies` tree. The class references itself, so `lazy(() => Category)` is mandatory (a bare `Category` ref is `undefined` at decorator evaluation time):

```ts
import { lazy } from "@mongez/reinforcements";
import { BelongsTo, HasMany, Model, RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class Category extends Model<CategorySchema> {
  public static table = "categories";
  public static schema = categorySchema;

  @BelongsTo(lazy(() => Category), "parent_id")
  public parent?: Category;

  @HasMany(lazy(() => Category), "parent_id")
  public children?: Category[];
}

// Walk one level:
const cat = await Category.query().with("parent", "children").find(id);
```

The trick: don't try to recursively `.with("parent.parent.parent...")` for unbounded depth. That's a graph traversal, and either ceiling it at a known depth or using a recursive CTE (Postgres) / `$graphLookup` (MongoDB) via `.joinRaw()` is the right answer for arbitrary depth.

## Polymorphic relations — not first-class, but doable

Cascade doesn't ship dedicated polymorphic helpers (the Laravel-style `morphTo` / `morphMany`). The standalone way to model "a Comment that can belong to a Post or a Video" is to store the type discriminator and id explicitly:

```ts
// Comment has commentable_type ("Post" | "Video") and commentable_id
@RegisterModel()
export class Comment extends Model<CommentSchema> {
  public static schema = v.object({
    commentable_type: v.enum(["Post", "Video"]),
    commentable_id: v.string(),
    body: v.string(),
  });
  // No decorator-based `commentable` relation — load it conditionally in a service:
}

async function loadCommentable(c: Comment) {
  const type = c.get("commentable_type");
  const id = c.get("commentable_id");
  if (type === "Post") return Post.find(id);
  if (type === "Video") return Video.find(id);
}
```

It's a few lines of code; baking polymorphism into the framework adds complexity that most apps don't need. If your domain has heavy polymorphism, consider whether you actually want one big `commentable` field or a per-type relation (`PostComment`, `VideoComment`).

## `.with()` vs `.joinWith()` — picking the right loader

Both load related data. They make different tradeoffs:

| Aspect                          | `.with()`                              | `.joinWith()`                          |
| ------------------------------- | -------------------------------------- | -------------------------------------- |
| Query count                     | 1 + N (one per relation)               | 1 (single query with JOIN / `$lookup`) |
| Hydrates to model instances     | ✅ Always                              | ✅ Always                              |
| Best for `belongsTo` / `hasOne` | ✅ Fine                                | ✅ Often better — fewer round-trips    |
| Best for `hasMany`              | ✅ Better — JOIN duplicates parent rows | ❌ Avoid — Cartesian explosion         |
| Best for `belongsToMany`        | ✅ Better — pivot indirection           | ❌ Not supported the same way          |
| Per-relation constraints        | ✅ Full callback support               | Limited                                |
| Cross-table filters             | ❌ Filter is on the related query only | ✅ Can `.where()` on joined columns    |

The rule of thumb: **default to `.with()`**. Reach for `.joinWith()` when:

- You're loading a single `belongsTo` and want one query instead of two.
- You need to **filter** on the joined columns (`Post.joinWith("author").where("users.role", "admin")`).
- The round-trip cost of two queries is hurting a hot path.

For `hasMany`, `.joinWith()` is almost never what you want — joining a parent to its children multiplies parent rows in the result set, and you pay to deduplicate.

## Common pitfalls

### N+1 in loops

```ts
for (const user of users) {
  console.log(await user.posts); // ❌ one query per user
}
```

The fix: pre-load on the original query.

```ts
const users = await User.query().with("posts").get(); // ✅ 2 queries total
for (const user of users) {
  console.log(user.posts);
}
```

The [Relationships essentials](../the-basics/03-relationships.md) covers this in more depth — it's the single most common relation footgun.

### Foreign-key naming surprises

Cascade infers foreign keys based on the *relation owner's* perspective (see `key-conventions.ts`):

- `User`'s `@HasMany(Post) public posts` → looks for `user_id` on `posts`.
- `Post`'s `@BelongsTo(User) public author` → looks for `author_id` on `posts` (named after the **property name** unless customised).
- `Post`'s `@BelongsTo(User, "author_id") public author` → looks for `author_id` (explicit, same as the inferred default in this case).

If your column is named `created_by` and your property is `author`, you have to spell out the foreign key:

```ts
@BelongsTo(lazy(() => User), { foreignKey: "created_by" })
public author?: User;
```

Cascade won't guess. If the inference doesn't match, the relation silently returns `null` / `[]`.

### Forgetting to declare the inverse

If `Post` has `@BelongsTo(User) public author` but `User` doesn't have `@HasMany(Post) public posts`, you can load `post.author` but not `user.posts`. They're independent declarations; the inverse isn't auto-derived. Declare both sides explicitly — it's almost always what you want.

### Eager-loading the wrong relation in lists

Eager loading is a *batch* optimisation. If you fetch 1000 users and `.with("posts")`, Cascade pulls every post for those 1000 users into memory. That's correct for typical "show a list with a few posts each" UIs, but if some users have thousands of posts each, the working set blows up. Use a constraint:

```ts
User.query().with("posts", q => q.limit(5)).get();
```

Or load relations lazily for the small subset that actually needs them.

## Going further

- **The mental-model section** (four layers: schema → migration → relation → query) — [Relationships essentials](../the-basics/03-relationships.md)
- **Ad-hoc joins** for cross-table queries without declared relations — [Joins guide](./joins.md)
- **Eager-load via JOIN** (single-query for `belongsTo` / `hasOne`) — `joinWith` reference: [Query Builder API reference](../reference/query-builder-api.md#joinwithrelations)
- **Recipes for polymorphic, deep trees, and audit-aware relations** — recipes folder *(planned)*
