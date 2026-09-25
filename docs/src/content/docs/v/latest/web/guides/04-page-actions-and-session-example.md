---
title: Page actions with a user session
description: A small account page that reads a signed-in user and saves a form.
sidebar:
  order: 4
---

## The idea

A **loader** handles the page's GET request and supplies data for rendering. An **action** handles a POST from a form on that page. Warlock runs the page's session resolver before either one, so both can read the signed-in user.

The server keeps the full user model as `session.model`. The browser only receives the small, safe object returned by `project` as `session.user`. The `<Form>` below works as a normal HTML form without JavaScript; with JavaScript it submits in place and handles the redirect.

This example assumes an existing `User` model and a login page that sets Auth session cookies. Install matching `@warlock.js/web`, `@warlock.js/auth`, and `@warlock.js/seal` 5.22.1 packages.

### 1. Connect Auth to Web

```ts title="src/config/web.ts"
import { pageSession } from "@warlock.js/auth";
import type { WebConfigurations } from "@warlock.js/web";
import type { User } from "app/users/models/user";

export default {
  session: pageSession({
    project: (user: User) => ({
      id: Number(user.id),
      name: user.get("name"),
    }),
  }),
} satisfies WebConfigurations;
```

Only put fields in `project` that may be sent to the browser. Never project passwords, tokens, or private model fields.

For typed `useUser()` and `session.model`, add the app's session shape:

```ts title="src/types/session.d.ts"
import type { User } from "app/users/models/user";

declare module "@warlock.js/web" {
  interface SessionRegistry {
    user: { id: number; name: string };
    model: User;
  }
}
```

### 2. Guard the page, load the name, and save it

```ts title="src/web/account/index.setup.ts"
import { v } from "@warlock.js/seal";
import type { PageActionContext, PageConfig, PageLoaderContext } from "@warlock.js/web";
import { requireUser } from "@warlock.js/web/session";

export const config = {
  route: { path: "/account", name: "account" },
  middleware: [requireUser({ loginPath: "/login" })],
  action: {
    validation: v.object({
      name: v.string().min(2).required(),
    }),
  },
} satisfies PageConfig;

export async function loader(ctx: PageLoaderContext<undefined, typeof config.route>) {
  const user = requireUser(ctx);
  return { name: user.get("name") };
}

export async function action({
  request,
  response,
  session,
}: PageActionContext<typeof config.action>) {
  if (!session?.model) {
    return response.unauthorized({ message: "Please sign in." });
  }

  const { name } = request.validated();
  await session.model.save({ merge: { name } });

  // Redirect after a successful POST so reload does not submit again.
  return response.redirect("/account");
}
```

`requireUser` sends guests to `/login?redirect=%2Faccount`. The action uses the user from the session, so the form cannot choose which account to update. Validation runs before the action; invalid input returns a 422 response and does not call `save()`.

### 3. Render the form and read the safe user data

```tsx title="src/web/account/index.page.tsx"
import { FieldError, Form, useActionData, useIsSubmitting, useUser } from "@warlock.js/web";
import type { PageProps } from "@warlock.js/web";
import type { action, loader } from "./index.setup";

export default function AccountPage({ data }: PageProps<typeof loader>) {
  const user = useUser();
  const result = useActionData<typeof action>();
  const saving = useIsSubmitting();

  return (
    <main>
      <h1>Account</h1>
      <p>Signed in as {user?.name}</p>

      <Form>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          required
          defaultValue={String(result?.values?.name ?? data.name)}
        />
        <FieldError name="name" />
        {result?.formErrors.map((message) => (
          <p key={message} role="alert">{message}</p>
        ))}
        <button type="submit" disabled={saving}>Save</button>
      </Form>
    </main>
  );
}
```

On GET, the loader reads the model and the page receives `data.name`. On POST, `<Form>` sends the fields to the page action. If validation fails, `FieldError` and `useActionData` show the errors. If saving succeeds, the redirect runs the loader again and shows the new name. Without JavaScript, the browser follows a standard POST/redirect/GET; with JavaScript, Web enhances the same form.

The login action should set Auth session cookies, and a logout POST should revoke the session and clear those cookies. See [Sessions for pages](/v/latest/auth/guides/sessions-for-pages/) and [Page actions](/v/latest/web/essentials/15-page-actions/) for those flows and named actions.