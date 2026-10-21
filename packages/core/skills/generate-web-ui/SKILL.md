---
name: generate-web-ui
description: "Generate web pages, schema-backed forms and CRUD UI with warlock generate page, form and crud-ui. Includes setup companions, design-system controls, useSubmitForm, optional guarded endpoints and module CRUD prerequisites."
---

# Generate web UI

Run these commands from an app with `@warlock.js/web` installed and the app's
design system in `src/web/design-system/components/`. Controls are default
exports, imported individually through `web/design-system/components/<name>`;
they implement Mongez `useFormControl` and accept `name`, `label`, `hint` and
`error`. Forms import `Form` directly from `@mongez/react-form`.

```sh
npx warlock generate page account/settings
npx warlock generate page dashboard --interactive
npx warlock generate form contact
npx warlock generate form feedback --module posts --endpoint
npx warlock generate crud-ui posts --dry-run --json
npx warlock generate crud-ui posts
```

`page account/settings` creates `src/web/account/settings.page.tsx` and
`settings.setup.ts`, with `/account/settings`, a named route, a loader and
`config.metadata`. `--interactive` also creates a counter feature hook under
`hooks/`; replace that example with the feature's behavior. Executable page
exports belong in `.setup.ts`, UI in `.page.tsx`, state and effects in hooks.

`form contact` creates `src/web/forms/contact-form.tsx`, a props file, a
`use-contact-form` hook using `useSubmitForm`, and
`src/shared/schema/contact.schema.ts`. The starter schema has one `name`
string field; edit that shared schema and the controls together. Its default
submit target is `/contact`; supply a real endpoint or set the form's `path`.
With `--module posts`, output lives under `src/web/posts/`, the shared schema
under `src/shared/schema/posts/`, and the target is `/posts/contact`.
The module must exist. `--endpoint` requires `--module`, adds a controller
with `validation` and `responseSchema`, and appends a guarded POST route.
This initial endpoint validates and echoes the input; replace that body with a
service call to persist it. It does not create database persistence for you.

For CRUD UI, first generate a full module with
`npx warlock generate module posts`. Define its create/update schemas and
list query schema, then run `npx warlock generate crud-ui posts`.
The generator loads the real Seal schemas using the app loader, so their
imports must resolve. These schema modules must be safe to import on both
client and server. Plain string fields map to TextInput, password names to
PasswordInput, email/date/time/date-time formats to the corresponding controls,
and booleans to CheckboxInput. Unions, nullable fields, enums, numeric fields,
nested objects and arrays require custom control decisions and are rejected
before writing output. An empty module schema produces an empty form.

CRUD output contains list/create/edit pages and setup companions, separate
create/update forms, their hooks and props, list/edit/delete hooks, and a
delete action component. Lists use the existing GET endpoint and its
`data`/`pagination` contract (`page` and `pages`). Literal fields in
`listPostsQuerySchema` become filter inputs; `page` is controlled by navigation
and `limit` remains the endpoint default. Edit reads GET `/posts/:id`, create
submits POST `/posts`, update uses PUT `/posts/:id`, and delete uses DELETE
`/posts/:id`. Successful deletion refreshes the list. Mutation forms show
validation errors, pending state and success feedback.

CRUD generation accepts the conventional full module route file, allowing
formatting and comments. It fails closed for custom routes/guards instead of
inferring authorization. Pages require `requireUser({ userType: "user" })`,
matching the starter's `guarded` helper. Configure `web.session` with the auth
page-session resolver before visiting these pages. Endpoint guards still
run on every API request; customized authorization requires a hand-written UI.

All three commands support `--dry-run --json` through the normal generation
report. Existing generated files are skipped unless `--force` is explicit.
Route registration is idempotent and retains existing module content.
