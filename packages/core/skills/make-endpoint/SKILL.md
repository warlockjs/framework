---
name: make-endpoint
description: 'Generate one endpoint spec-first with `warlock make endpoint <module>/<name>` — request schema (from `--schema`), service, resource, a single controller using `request.validated()` with an OpenAPI `responseSchema`, the route (guarded by default, `public: true` with `--public`), a locale key, and a test that hits the real HTTP stack. Also: `--dry-run` and `--json` on every `make` / `generate.*` / `add` command. Triggers: `warlock make endpoint`, `make.endpoint`, `generate.endpoint`, `warlock make`, `--schema`, `--resource`, `--public`, `--auth`, `--dry-run`, `--json`, `public: true`, `GenerationReport`; "scaffold an endpoint", "add a POST route with validation and a test", "preview what a generator writes", "machine-readable generator output". Skip: a whole CRUD module — the `create-module` topic; controller shape by hand — the `create-controller` topic.'
---

# Warlock — make an endpoint

Write the request schema, then let the generator write everything around it in the framework's conventions.

## 1. The spec

```ts title="post.spec-input.ts"
import { type Infer, v } from "@warlock.js/seal";

export const postInput = v.object({
  title: v.string().min(3),
  views: v.int().min(1).optional(),
});

export type PostInput = Infer<typeof postInput>;
```

The file may live anywhere. Outside `src/` it is copied into the module (relative imports re-pointed); under `src/` it is imported where it lives. The export is found by the conventional name (`createPostSchema`), else the only `v.object(...)` export, else the default export.

## 2. Preview, then generate

```bash
warlock make endpoint posts/create-post --schema ./post.spec-input.ts --dry-run --json
warlock make endpoint posts/create-post --schema ./post.spec-input.ts
warlock make endpoint posts/update-post --method patch --schema ./post.spec-input.ts
warlock make endpoint contact/send-message --schema ./message.ts --public
```

Options: `--method get|post|put|patch|delete` (default `post`), `--path` (default `/<module>`, or `/<module>/:id` for put/patch/delete), `--resource <Name>` (default: the module's singular), `--auth` (default) or `--public`, `--force`, `--dry-run`, `--json`. `warlock generate.endpoint` and `warlock make.endpoint` are the same command.

## 3. What it writes (`src/app/posts/`)

- `schema/create-post.schema.ts` — `createPostSchema` and its `CreatePostSchema` type.
- `services/create-post.service.ts` — `createPostService(input)`; validated input only, never the request. Fill it in.
- `resources/post.resource.ts` — `PostResource` shaped from the schema fields (skipped when it exists).
- `controllers/create-post.controller.ts` — one handler:

```ts
export const createPostController: GuardedRequestHandler<CreatePostSchema> = async ({
  request,
  response,
}) => {
  const post = await createPostService(request.validated());

  return response.successCreate({
    message: t("posts.createPostSuccess"),
    post: new PostResource(post),
  });
};

createPostController.validation = { schema: createPostSchema };

createPostController.responseSchema = {
  201: { body: { message: "string", post: PostResource } },
};
```

- `routes.ts` — appended: `guarded(() => { router.post("/posts", createPostController); })`, or with `--public`: `router.post("/posts", createPostController, { public: true });`.
- `utils/locales.json` — `createPostSuccess` merged in (existing keys win).
- `tests/create-post.test.ts` — a valid request derived from the schema expecting `201` and the resource, a request missing a required field expecting a 4xx, and for guarded routes an anonymous `401` plus a signed-in case through `actingAs()`.

Existing files are skipped and reported (never overwritten without `--force`); a controller already in `routes.ts` is not registered twice.

## 4. Run its test

```bash
warlock test --related src/app/posts/tests/create-post.test.ts
```

The test needs `warlock add test`. Signed-in cases create a user through `auth.userType.user` (a test database); adjust its fields if your user model requires more. A required file field turns the happy path into an `it.todo` (JSON cannot carry files).

## `--dry-run` and `--json` everywhere

Every `generate.*` command, `make`, and `add` take both. `--dry-run` writes (and for `add`, installs) nothing. `--json` prints exactly one report on stdout — also on failure — and sends everything else to stderr:

```json
{
  "schemaVersion": 1,
  "command": "make endpoint",
  "dryRun": true,
  "ok": true,
  "written": ["src/app/posts/controllers/create-post.controller.ts"],
  "skipped": [
    {
      "path": "src/app/posts/resources/post.resource.ts",
      "reason": "exists (pass --force to overwrite)"
    }
  ],
  "files": [{ "path": "src/app/posts/routes.ts", "type": "update" }],
  "details": { "endpoint": { "method": "POST", "path": "/posts", "access": "guarded" } },
  "messages": []
}
```

`files[].type`: `create`, `overwrite`, `update`, `unchanged`, `skip`. On failure `ok: false` and `error` says why. `add --list --json` puts the feature catalog in `details.features`.

## `public: true`

`RouteOptions.public` changes nothing at runtime; it records that a route deliberately has no auth guard, so a mutating route without one reads as a decision. `warlock dev`, `warlock inspect` and `warlock check` (`WL9006`) read it.

## See also

- The `create-module` topic — a whole CRUD module.
- The `test-http` topic — the HTTP helpers the generated test uses.
- The `generate-openapi` topic — what `responseSchema` documents.
