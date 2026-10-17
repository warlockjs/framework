---
name: model-factories
description: 'Deterministic model factories for tests and seeders — `defineFactory(Model, (seed) => attributes)` with `make()`, `makeMany(n)`, `create()`, `create(n)`, `createMany(n)`, named states via `.state()` / `.with()`, and a faker-free seed (`seed.text`, `seed.email`, `seed.uuid`, `seed.date`, `seed.number`, `seed.pick`). Triggers: `defineFactory`, `Factory`, `FactorySeed`, `resetFactorySequences`, `userFactory`; "test fixtures", "create test users", "factory states", "deterministic test data", "build a request body for a test". Typical import `import { defineFactory } from "@warlock.js/core/tests"`. Skip: seeding a real database for development — the `write-seeder` topic; fakes — the `test-fakes` topic.'
---

# Warlock — model factories

A factory turns a sequence number into attributes. The n-th record a factory builds is the same on every run — no faker, no randomness — so snapshots and assertions stay stable.

## Define one per model

```ts title="src/app/users/tests/user.factory.ts"
import { Model } from "@warlock.js/cascade";
import { defineFactory } from "@warlock.js/core/tests";

// Your model; in an app this is `import { User } from "app/users/models/user"`.
type UserSchema = { name: string; email: string; password: string; emailVerifiedAt?: Date };

export class User extends Model<UserSchema> {
  public static table = "users";
}

export const userFactory = defineFactory(User, (seed) => ({
  name: seed.text("User"), // "User 1", "User 2", ...
  email: seed.email(), // "user1@example.test", ...
  password: "test-password",
}))
  .state("unverified", () => ({ emailVerifiedAt: undefined }))
  .state("named", (seed) => ({ name: `Named ${seed.sequence}` }));
```

Attributes are typed by the model's schema (`Partial` of it, as `Model.create()` takes). Keep factories next to the module's tests.

## Use it

```ts
// with: import { expectJson, testPost } from "@warlock.js/core/tests";
//       import { userFactory } from "./user.factory";
it("registers a user from a factory-built body", async () => {
  const body = userFactory.make({ email: "ada@example.test" }); // attributes only, no database

  const response = await testPost("/auth/register", body);

  expect((await expectJson<{ user: { email: string } }>(response, 201)).user.email).toBe(
    "ada@example.test",
  );
});

it("lists users", async () => {
  await userFactory.create(3); // three saved users, in order
  await userFactory.with("unverified", "named").create();
});
```

| Call                        | Returns            | Database |
| --------------------------- | ------------------ | -------- |
| `make(overrides?)`          | attributes         | no       |
| `makeMany(n, overrides?)`   | attributes[]       | no       |
| `create(overrides?)`        | `Promise<Model>`   | yes      |
| `create(n, overrides?)`     | `Promise<Model[]>` | yes      |
| `createMany(n, overrides?)` | `Promise<Model[]>` | yes      |
| `with(...states)`           | a derived factory  | —        |
| `state(name, fn)`           | the same factory   | —        |
| `resetSequence()`           | —                  | —        |

`create()` goes through the model's own `create()`, so casts, defaults, hooks and events run exactly as in the app. Overrides are a partial or a function of the seed: `make((seed) => ({ name: `Custom ${seed.sequence}` }))`. States apply in order on top of the definition, then the overrides. A derived factory shares the base sequence.

## The seed

| Member               | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| `sequence`           | 1 for the first record the factory builds, then 2, ... |
| `index`              | position within the current `makeMany` / `createMany`  |
| `text(prefix?)`      | `"<prefix> <sequence>"`                                |
| `email(prefix?)`     | `"<prefix><sequence>@example.test"` (default `user`)   |
| `uuid()`             | `00000000-0000-4000-8000-<sequence, 12 digits>`        |
| `date(offsetDays?)`  | 2026-01-01T00:00:00Z plus `offsetDays` days            |
| `number(min?, max?)` | an integer in `[min, max]`, cycling with the sequence  |
| `pick(values)`       | one of `values`, cycling with the sequence             |

`resetFactorySequences()` restarts every factory — call it in `beforeEach` when a test asserts exact values.

## Gotchas

- **Unique columns.** `seed.email()` is unique per factory sequence, not across test files; a database shared between files needs cleanup or `resetFactorySequences()` plus truncation, otherwise a second file collides on `user1@example.test`.
- **`make()` never touches the database.** It returns attributes, not a model instance — use it for request bodies and pure-logic tests.
- **An unknown state throws** and lists the defined ones.

## See also

- The `test-fakes` topic — fakes for mail, queue, cache, storage, clock and ids.
- The `write-seeder` topic — seeding a development database.
