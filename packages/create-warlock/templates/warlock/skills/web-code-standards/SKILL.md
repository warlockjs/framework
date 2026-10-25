---
name: web-code-standards
description: "Warlock web pages and setup files, component and hook ownership, Mongez forms, accessible controls, locale behavior and UI kit choices. Use when building or reviewing src/web features. Use code-standards instead for shared TypeScript rules."
---

# Web code standards

**Applies to:** `src/web/**` in this project. Read
the `code-standards` skill for the shared TypeScript rules,
and the relevant `@warlock.js/web` skill before using a framework feature.
This skill adds the web-specific rules; it does not override security or
module-boundary requirements. When reviewing existing code, identify debt
without expanding a requested edit into a wholesale refactor.

The bar is a page whose data flow and ownership a new teammate can explain
without tracing a large component, several implicit casts, and unrelated
network handlers. Good UI polish is not a substitute for that clarity.

## Feature directories

Keep files beside the web feature that owns them. For example, `src/web/posts/`
can own an archive, article route, reader controls, comments, and their hooks
and copy. `src/web/auth/` and `account/` own their flows; `src/web/admin/`
can own a guarded dashboard and its domain features. Root document, root
layout, error pages, home page, and shared site chrome stay at their common
ancestor.

When moving a page, check whether its URL is filesystem-derived. If it is,
moving the file changes the URL unless you first give `config` an explicit
`route`. Preserve any explicit `config.route.path` and `config.route.name`,
and keep protected pages under the layout that owns their server auth guard.
Place `locales.json` dictionaries with the feature they describe; site copy
belongs at the common physical source ancestor and admin-only copy belongs
under the admin layout. Warlock discovers these dictionaries automatically
and supplies the selected locale through request translation helpers and
`useTrans()`. An optional nonempty `$group` replaces the inferred static
directory namespace. Every flattened translation key must have one owner;
ancestor and child dictionaries cannot redefine the same key. Keep legacy
`register()` dictionaries only where global translations are still needed.

Within a web feature, use `components/`, `hooks/`, and `utils/` for their
named purpose; do not create `lib/` as a catch-all. These folders have no
barrel `index.ts`: import the named component, hook, or helper from its own
file. These exact imports keep client bundles lean and prevent server-only code from being pulled through a barrel. The `code-standards` skill allows sub-folder barrels only for `src/app/**` server modules. Keep types in `types/` when a feature has several contracts, or in one
`<feature>.types.ts` file when they are small. Do not duplicate a contract in
both places. Put component props in that dedicated type module by default;
keep a tiny private prop type beside a component only when extracting it would
make the feature harder to read.

## 1. Keep the page contract, make the implementation thin

Page logic lives in the matching `.setup.ts` file: `config`, `loader`,
`register`, and `action`/`actions`. The UI file owns its named default
component; re-export a framework-required named component such as `ErrorBoundary`
from that component's own file. Pair `layout.tsx` with
`layout.setup.ts`, `root.tsx` with `root.setup.ts`, `forbidden.page.tsx` with
`forbidden.setup.ts`, and `error.page.tsx` with
`error.setup.ts`. Use type-only imports from setup for loader/action inference.
The framework projects browser-safe `register()` code to the client. Put route,
cache, validation, middleware, metadata, and sitemap policy inside `config`;
metadata always belongs in `config.metadata`. Do not add an empty setup file
when a component has no configuration, loader, action, or registration work.
The starter follows this boundary for root configuration, home route policy
and translations, and not-found metadata.

Use the config type that matches the module. A page can preserve loader data
inference for metadata by satisfying `PageConfig<typeof loader>`:

```ts title="src/web/posts.setup.ts"
import type { PageConfig } from "@warlock.js/web";

export async function loader() {
  return { title: "Posts" };
}

export const config = {
  route: { path: "/posts", name: "posts.index" },
  middleware: [requireUser],
  validation: { query: postsQuery },
  metadata: ({ data }) => ({ title: data.title }),
  sitemap: { changefreq: "daily" },
} satisfies PageConfig<typeof loader>;
```

```tsx title="src/web/posts.page.tsx"
import type { PageProps } from "@warlock.js/web";
import type { loader } from "./posts.setup";

export default function PostsPage({ data }: PageProps<typeof loader>) {
  return <main>{data.title}</main>;
}
```

Use `href(name, params, query)` for named page navigation. Generated declarations
in `.warlock/typings/web-routes.d.ts` check route names and required path
parameters when included in the app's TypeScript project; runtime route-table
validation still applies. Do not widen those contracts to strings or add casts.

Layouts use one `config satisfies LayoutConfig` object for `prefix`,
`middleware`, `metadata`, and a sitemap default. Roots use one
`config satisfies RootConfig` object for `middleware` and the static `strictMode`
flag, plus metadata defaults. Root modules do not declare routes, prefixes,
validation, cache, or sitemap policy.

```ts title="src/web/account/layout.setup.ts"
import type { LayoutConfig } from "@warlock.js/web";
export const config = {
  prefix: "/account",
  middleware: [requireUser],
  metadata: { robots: "noindex" },
  sitemap: false,
} satisfies LayoutConfig;
```

```ts title="src/web/root.setup.ts"
import type { RootConfig } from "@warlock.js/web";

export const config = {
  middleware: [loadRequestContext],
} satisfies RootConfig;
```

Every loader is an exported named `async function` with a public typed context;
let TypeScript infer its return. Use
`PageLoaderContext<typeof config.validation, typeof config.route>` for a page,
`LayoutLoaderContext` for a layout, and `AppLoaderContext` for the root. Do not
annotate the whole function as `PageLoader`, use `satisfies` on a loader,
duplicate its payload shape, or cast an unknown return.
A setup file declares the route contract and coordinates a controller-like
loader; its UI file composes presentational components. The loader validates input, calls
named services under `src/app/<domain>/services/`, converts results through
their resources, and returns the page data. **Every model/repository read and
every business rule belongs in an app service, even when the loader would need
only one query.** Do not import models or repositories into page or layout
loaders. Keep service orchestration in the loader; keep business decisions,
queries, aggregations, and domain transformations in the service. A service
must have a meaningful domain name and own the operation, not exist as a
generic pass-through for a repository method.

Give every component one responsibility and one reason to change. Define one
component per file, with a named default export. Extract substantive view
sections into cohesive components. Put hooks in `hooks/` and pure UI helpers
in `utils/`, one hook or helper per file, exported by name. A hook owns state,
effects, handlers, navigation, and client mutations; a utility has no React or
browser lifecycle dependency. A presentational component needs no hook.

Keep a small piece of logic or a private helper inline only when it is tightly
coupled to that one component and keeping it there leaves the file small and
focused. A component file past roughly 150 lines, a second component, or multiple
helpers is a split signal, not a mechanical line limit: split at ownership
boundaries, never into arbitrary chunks to meet a count. The one-component rule
still applies. Framework logic exports remain in setup even when delegated.
Keep feature CSS beside the feature and import it from the owning presentation
boundary; keep loading, error, empty, focus, reduced-motion, and locale behavior
with that boundary.

Preserve the framework's rendering boundary: `root.tsx` owns the document,
`#vessel` and `<Scripts />`; the loader runs on the server, while the rendered
component can run on the server **and** the client. Do not move request,
database, or secret access into a component or hook. If page-only exports
need server dependencies, use them only in server-side exports and follow the
web skill's import-graph rules. A new auth gate belongs in server middleware,
not a hidden link or a client-side redirect.

**Example split:** a post page's loader passes validated input to
`app/posts/services/get-public-post.service.ts` and returns its resource
output; the page composes `PostArticle`, `PostComments`, and `RelatedPosts`;
`use-post-comments.ts` owns subscription, state, and handlers for
`PostComments`. Each piece has one reason to change.

## Declaration spacing and local types

Put one blank line after the final import. Keep a short related declaration run
together, then put a blank line before a substantial multiline expression such
as a `useSubmitForm()` configuration. Declare a schema alias immediately after
its `const` schema instead of repeating `typeof schema` through the file. When
state starts unset, write `useState<ErrorText>()`; do not add a redundant
`| undefined` union or pass `undefined` explicitly.

## 2. Make the server-to-browser data contract explicit

- Validate URL parameters and query input at the page boundary. Use the
  framework's validated request rather than `request.input()` casts where
  validation is available. A `page` parameter must affect a real bounded
  query; accepting and returning it without paging is misleading.
- Have the app service query only what the view needs. Filter, sort, limit,
  and paginate in the data source **before** serialization or rendering. Use
  a count/aggregate query for totals instead of loading a table to count it.
  Batch related reads; do not do one author lookup or image transformation
  per row on an archive page. Cache does not make an unbounded cold path safe.
- Treat resources as the wire-format gate. Send the resource's deliberate
  public shape, never a raw model, secret field, or request object to the
  browser. Do not scatter `toJSON() as unknown as SomeRow` through pages:
  fix or explicitly validate the resource contract at a single boundary so
  refactors cannot silently invalidate loader data.
- Publicly cached pages must not contain viewer-specific state. Keep optional
  identity in an appropriate request-scoped boundary and review cache keys,
  invalidation, and private-page behaviour when the rendered data changes.
- A deferred key needs a meaningful loading state and an error boundary at
  the consuming section. Keep essential page data non-deferred. Do not wrap
  already-resolved markup in more Suspense boundaries merely to appear
  optimized; measure a real hydration or streaming benefit first.
- Metadata, canonical links, and sitemap entries should derive from the
  same validated, public data as the page. Keep private routes out of public
  discovery, and do not generate database-backed assets on every GET.

## 3. Components render; custom hooks own behavior

**Delegate behavior to the component's dedicated custom hook by default.** A
component declares props, calls that hook if needed, and renders JSX from its
props and the hook's returned values. Put `useState`,
`useEffect`, subscriptions, timers, browser API calls, derived-value
calculations, event handlers, mutations, and navigation decisions in a
separate custom-hook file. Keep pure domain calculations in `src/app`
services; a hook may call a small pure UI helper outside the component.
Use section 1's inline exception only for small, tightly coupled logic;
reuse or file growth means it belongs in its own hook or utility file.
JSX conditionals that only select which markup to show are presentation,
not a license to implement business rules in render.

Render must be deterministic for the same props and request data. Read
`window`, `document`, `localStorage`, browser clocks, and capabilities in
hook handlers or effects, not during server rendering or initial hydration.
Use request-provided data for the first client frame; do not silently render
another value and hope hydration reconciles it.

Identify the source of truth for each value. Loader data is server truth;
hook state is for an interaction or an intentional optimistic change.
Avoid copying props into hook state without a plan for refresh and client
navigation. Avoid setting another state variable inside a state-updater
callback. Prefer deriving display values from one authoritative state.

**State ownership.** Loader data is server truth. UI interaction state (open,
selection, draft input) lives in the component's own hook. Shared client state
goes only through a named store module, never a global variable or a copy
spread across components. Never copy props into state without a refresh plan.

Effects own their subscriptions and timers: unsubscribe, cancel, or ignore
stale async work on unmount or entity change. A failed script/socket load
must not leave a permanently rejected shared promise or silently disable a
feature for the rest of the session. Realtime events can arrive twice or
out of order; dedupe by stable identity and reconcile with refreshed data.

## 4. Keep mutations and forms cohesive

Client mutations belong in the feature's custom hook, **never inside the
component or its JSX callback**. The hook owns the path from input to API
request to success/error state to refresh or navigation. App services own
the operation's business rules; the browser must not reimplement them.
Never assume an HTTP promise cannot reject. Do not swallow a failed mutation
or network subscription; show actionable UI feedback and log at the
appropriate boundary without leaking user data.

Share a create/edit form's fields, request encoding, and validation-error
mapping when they are the same contract. Keep differences explicit (such as
required-on-create image versus optional-on-edit). Do not build a generic
form engine for one pair of pages. Use typed request and response shapes;
`unknown` is for a genuine boundary and must be narrowed before use.

Keep secrets and access tokens out of browser storage. Client affordances
are not authorization; protected page loaders and mutation endpoints must
enforce the same policy independently. Use a full navigation when an auth or
document boundary requires it, otherwise prefer the framework's navigation
and refresh primitives so state and loader data stay in sync.

### Use Mongez React Form for every form

Always use `Form`, `useFormControl`, and `useSubmitButton` from
`@mongez/react-form`; the web stack already uses this package, including the
starter's contact form. Do not add a second form library or manage field
validation and submission state in parallel React state. Keep those hooks in
the control's and submit button's dedicated hook files, following section 1.

Declare validation in a browser-safe `<Form schema={schema}>` (Seal implements
Standard Schema), a control's `schema`, or `useFormControl({ rules: [...] })`.
The `rules` array contains imported rule objects, never rule-name strings.
For example, `{ name: "email", type: "email", required: true,
rules: [requiredRule, emailRule] }` uses Mongez's rules: `requiredRule` needs
`required: true`, and `emailRule` needs the control's `type: "email"`.
Put `requiredRule` first. Schema issues map back to registered control names,
so keep schema paths and control names aligned.

Never use `required`, `pattern`, `min`, `max`, `minLength`, or `type="email"`
as browser validation, or rely on the browser's constraint UI. These may be
Mongez rule configuration props; do not spread raw control props onto DOM
inputs. Mongez v4's `Form` renders `noValidate` by default; keep it enabled
and preserve it if using a custom form host. A schema-backed email field can
render `type="text"` with `inputMode="email"` and `autoComplete="email"`,
leaving email validation entirely to the form.

Render the control's `error` through `getErrorProps()` and connect the field
with `getInputProps()` (or equivalent explicit wiring for a custom widget).
This keeps field identity, focus, blur validation, and error announcement in
the same form contract. For example, each block below is its own file:

```ts title="src/web/contact/contact.schema.ts"
import { v } from "@warlock.js/seal";

export const contactSchema = v.object({ email: v.email() });
```

```ts title="src/web/contact/hooks/use-contact-email.ts"
import { useFormControl } from "@mongez/react-form";

export function useContactEmail() {
  return useFormControl({ name: "email" });
}
```

```tsx title="src/web/contact/components/contact-email.tsx"
import { useContactEmail } from "../hooks/use-contact-email";

export default function ContactEmail() {
  const { id, error, getInputProps, getErrorProps } = useContactEmail();

  return (
    <div>
      <label htmlFor={id}>Email</label>
      <input {...getInputProps({ type: "text", inputMode: "email", autoComplete: "email" })} />
      {error ? <span {...getErrorProps()}>{error}</span> : null}
    </div>
  );
}
```

Render `ContactEmail` inside `<Form schema={contactSchema} onSubmit={submit}>`;
the feature hook owns `submit`. The submit button's hook calls
`useSubmitButton()` and exposes `disabled` and `isSubmitting` to its component.
For API mutations, use `useSubmitForm` from `@warlock.js/web/form` in the
feature hook. With generated route declarations and a handler's `responseSchema`,
`useSubmitForm({ route })` infers the declared success body; `ApiResponse` from
`@warlock.js/web` reads a declared status body. Do not replace this inference
with casts. Server endpoints must still validate input independently.

### Use the shared design-system controls

For Tailwind + shadcn projects, use the controls in `src/web/design-system/`:
TextInput, EmailInput, PasswordInput, TextareaInput, SelectInput (search),
MultiSelectInput, DatePickerInput, TimePickerInput, DateTimePickerInput,
CheckboxInput, RadioInput, SwitchInput, FileInput, and SubmitButton.
Import each component directly, for example
`import TextInput from "web/design-system/components/text-input";` — no barrels.
Use `Form` from `@mongez/react-form` directly. Every control requires a stable
explicit `id`, `name`, and visible `label`, and accepts `hint`, `error`,
Mongez `schema`/`rules`, and `validateOn`. Put behavior in design-system hooks
and props in design-system types. See the Web `build-accessible-controls`
topic for keyboard/focus, RTL, reset and calendar-date semantics.

```tsx
import { Form } from "@mongez/react-form";
import TextInput from "web/design-system/components/text-input";
import SubmitButton from "web/design-system/components/submit-button";

export default function ProfileForm() {
  return (
    <Form>
      <TextInput id="profile-name" name="name" label="Name" hint="Display name" />
      <SubmitButton id="profile-save" name="save" label="Save" />
    </Form>
  );
}
```

The full-stack preset and shadcn selection scaffold these controls. Existing
Tailwind apps can run `npx warlock add design-system`; install Tailwind first
with `npx warlock add tailwind` when missing. Existing files are preserved.

### Build custom controls with the project's UI kit

Do not render native `<select>`, `<input type="checkbox">`,
`<input type="radio">`, or `<input type="date">` UI. Build a searchable
select/dropdown with a search input, a custom checkbox, custom radio
controls, and a custom date picker. Each field uses `useFormControl` through
its dedicated hook; a radio group registers one selected value for the group.
Connect value/checked changes, blur, disabled state, focus refs, validation,
and errors to that control. Configure a checkbox control with
`type: "checkbox"` and wire `checked` / `setChecked`. Adapt other widget
callbacks to `changeValue`; do not blindly spread DOM input props onto a kit
component with a different callback contract. Keep search text and popup state separate from
the selected form value. A kit's hidden input for submission is acceptable;
it must not display native UI or become a second validation source.

Check the existing styling stack and UI kit before building controls:

- With Tailwind and shadcn/ui already installed, compose its components:
  Command + Popover for a searchable select, Checkbox, RadioGroup, and
  Calendar + Popover for dates. Keep Mongez as the form owner rather than
  copying a kit example that introduces another form library.
- With Tailwind but no shadcn/ui, or with no UI kit, ask the user which kit
  to use **before installing anything**. Recommend shadcn/ui for Tailwind
  projects because its composable accessible primitives fit the styling
  stack. Explain the recommendation for other stacks and wait for the
  user's choice; never silently add dependencies.
- With another established kit and no Tailwind, use its corresponding
  accessible primitives and the same Mongez adapters.

Custom controls must preserve the accessibility native controls supplied.
Follow the WAI-ARIA APG [combobox/listbox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/),
[checkbox](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/),
[radiogroup](https://www.w3.org/WAI/ARIA/apg/patterns/radio/), and
[date picker dialog/grid](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)
patterns. Preserve labels, visible focus, disabled/selected/checked states,
`aria-invalid`, and error descriptions linked to `getErrorProps()` output.
Support keyboard search and arrow navigation, Enter selection, Space toggling,
and Escape dismissal as appropriate. Manage popup entry and focus return;
a modal date dialog traps focus and its calendar grid supports day/month
keyboard navigation. Kit composition still needs correct labels, focus refs,
and announced errors; styling alone does not make a control accessible.

## 5. Ship usable, localizable presentation

- Use semantic landmarks, headings, buttons, links, and explicit form labels.
  A placeholder is not a label. Put validation feedback next to its input;
  announce asynchronous success and failure accessibly. Preserve visible
  keyboard focus, reduced-motion preferences, and useful empty/loading/
  failure states.
- Reuse design tokens and cohesive feature components. Keep utility classes
  readable; extract repeated semantics or interactions, not an abstraction
  for every repeated class string.
- If the UI offers a language switch, translate first-party visible copy,
  metadata, and accessible names for supported locales. User-generated
  content can remain in its original language. Do not claim a locale is
  complete when only the navigation is translated.
- Comments explain non-obvious constraints or measured tradeoffs. They do not
  narrate ordinary JSX or promise performance gains without evidence.
  Remove stale starter examples and unexplained debugging writes before
  shipping.

## 6. Review and enforcement

Apply the shared `code-standards` rules to web TypeScript as well: `type` for
plain props/data, no `any`, no swallowed catches, no unsafe assertions used
to hide an unknown data contract. Configure non-mutating Oxlint and formatting
checks to enforce rules that can be automated; do not rely on a lint command
that rewrites files as the only quality gate.

When tests are enabled, cover high-value behaviour through the public page
and component contracts: server render and hydration, pagination/filtering,
auth and error boundaries, form success/failure, navigation refresh, and
realtime cleanup. Co-locate focused tests per the testing-strategy skill.
Review accessibility and locale behavior in the actual supported modes.

Before approving a web change, ask:

1. Can a reader identify the page's server data, browser state, and side
   effects without untangling unrelated responsibilities?
2. Does every loader obtain data and business decisions from a named app
   service, with models/repositories kept out of the web layer?
3. Does each component have one responsibility and its own file, with hooks
   and helpers extracted except for the small, tightly coupled inline case?
4. Is the service query bounded, the resource shape intentional, and the
   cache scope safe?
5. Do refresh, navigation, errors, retries, and cleanup leave the UI correct?
6. Do forms use Mongez schema/rules and accessible custom controls, with
   native validation disabled and the UI kit choice agreed before installation?
   Are interactions translated to the degree the interface promises?
7. Are the relevant quality rules enforced or covered by focused tests,
   rather than described only in comments?
