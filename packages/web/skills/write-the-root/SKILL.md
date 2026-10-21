---
name: write-the-root
description: 'Author `src/web/root.tsx`, the full-document application root that owns `<html>`, `<head>`, and `<body>`, places page metadata with `<Head />`, renders the hydrated subtree inside `#vessel`, and emits the payload with `<Scripts />`. Triggers: `root.tsx`, `AppProps`, `AppLoader`, `Head`, `metadata.viewport`, `Scripts`, `id="vessel"`; "customize the root document", "add html lang", "add an app provider", "where do Head and Scripts go"; typical import `import { Head, Scripts, type AppProps } from "@warlock.js/web"`. Skip: page component contract — the `create-a-page` topic; layout wrappers — the `use-layouts` topic; CSS delivery — the `serve-styles` topic; competing roots `next/layout`, Remix `root`, React `createRoot`.'
---

# Warlock — write the root

`src/web/root.tsx` is the application document. Its default export renders the complete `<html>` tree and contains `#vessel`, where client navigation replaces the layout and page. The browser hydrates the complete document so React sees the same ancestor tree as SSR.

Use `root.setup.ts` for root `config` (including `config.metadata`), loader, or universal
`register()` while `root.tsx` remains the document component. `strictMode` is
statically projected from the setup file. Do not value-import setup from the UI;
type-only imports are allowed, and duplicate exports fail.

`root.tsx` owns the default document component and any named `ErrorBoundary`.
`root.setup.ts` owns `config`, `loader`, and `register`. Metadata belongs in `config.metadata`. `RootConfig`
owns `middleware`, `strictMode`, and metadata policy. Keep sitewide sitemap
and robots serving in `web.sitemap` and `web.robots`.

## The shape

```tsx title="src/web/root.tsx"
import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";

export default function App({ children }: AppProps) {
  return (
    <html lang="en">
      <head>
        <Head />
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <div id="vessel">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
```

The root component is synchronous. HTTP work belongs in an `AppLoader`; the component receives its result as `data`.

## `lang` and `dir`

The root owns `<html>`, so it also owns `lang` and `dir` — the framework never injects either. Read the current locale with `useLocale()` and derive the writing direction from it with `useTextDirection()`, both from `@warlock.js/web`:

```tsx title="src/web/root.tsx"
import { Head, Scripts, useLocale, useTextDirection } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";

export default function App({ children }: AppProps) {
  const locale = useLocale();

  return (
    <html lang={locale} dir={useTextDirection()}>
      <head>
        <Head />
      </head>
      <body>
        <div id="vessel">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
```

`useTextDirection()` derives `"rtl"` or `"ltr"` from the same locale `useLocale()` already exposes — via `localeDirection()`, a pure function safe to call on the server or the client. No hydration payload change is involved: the direction is computed from the locale that already made the trip, not carried separately.

To switch the active locale without a full reload, call `changeLocaleCode(code)`. The switch commits a browser locale preference only after the replacement tree is ready, so a failed or superseded request cannot change the next document load. `lang` and `dir` follow the committed locale on the next render (and every render after).

### `useTrans()` survives hydration

The hydration payload ships a `translations` key holding **only the active locale's keywords** (never the other locales' tables), and `<Scripts />` carries it to the browser. `useTrans()` reads from it before the first client render, so the hydrated text matches the server's. How it gets there depends on where the copy came from:

- **Route `locales.json` (scoped mode, the `localize-pages` topic).** The payload also carries `translationMode: "scoped"`. `LocaleProvider` receives that snapshot and `useTrans()` translates from it; the route JSON is **not** registered into a process-global localization table, so a request or a client navigation cannot inherit another route's keywords.
- **Module translations (`groupedTranslations`, module `locales.json`; legacy mode).** There is no `translationMode`, so the client installs the payload's keywords into `@mongez/localization`'s global table for the payload's locale (`extend(locale, translations)`) _before_ any `register()` hook runs and before the first client render. The same step runs on every client navigation, `refresh()` and `changeLocaleCode()`, so a page does not need its own `register()` to repeat copy the server already sent.

Either way, a component that calls `useTrans()` under `#vessel` renders the same strings on the server and in the browser. Do not read translations from `navigator.language` or a client-only store during render; that is a hydration mismatch (see the `render-client-only` topic).

## Document hydration and `#vessel`

SSR and initial hydration both render `App → html/body → #vessel → Layout → Page`.
React's `useId()` depends on that ancestry, including siblings outside `#vessel`.
Keep exactly one element with `id="vessel"` around `{children}`. Client navigation
replaces its layout/page children while preserving the root document.

Root components and providers execute in the browser as well as on the server.
Keep server work in `root.setup.ts` loaders and pass browser-safe results through
`data`. Head, stylesheet, locale and script slots travel with the initial payload
so the root renders the same document during hydration. No explicit form ID is
required merely because a form renders below a layout:

```tsx
import { Form } from "@mongez/react-form";

export default function ContactPage() {
  return (
    <Form>
      <button type="submit">Send</button>
    </Form>
  );
}
```

Use explicit IDs when an application needs a named instance; do not rewrite or
suppress React's generated IDs or hydration warnings.

If `root.tsx` or `root.setup.ts` (or any module they need) fails to load or the setup `register()` throws, there is no trustworthy Layout+Page composition left to hydrate — Warlock falls back to a plain document with no hydration script at all rather than hydrate the browser against markup nothing can vouch for. See the `create-a-page` topic for the app's own `error.page.tsx` boundary, which is tried first.

## `<Head />`

`<Head />` renders the resolved page metadata at that position. It takes no props and emits:

- `<meta charset="utf-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1">` by default (change it with `metadata.viewport`, or set `viewport: false` to emit none)
- title, description, keywords, canonical, and robots tags
- Open Graph and Twitter tags

Do not also hard-code a `<title>` for the current page; that produces two titles. Do not hard-code a viewport `<meta>` either: `<Head />` already emits one, so a second would duplicate it. Static root-wide tags such as a favicon or application name can sit beside `<Head />`.

## `<Scripts />`

`<Scripts />` emits the escaped `application/json` payload that hydration and client navigation consume, followed by the hydration client entry `<script type="module">` (Stage 1 streaming SSR renders both through React now, in this one component — see below). Put it after `#vessel`, normally near the end of `<body>`.

For a Content Security Policy nonce:

```tsx title="src/web/root.tsx"
import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";

export default function App({ children, shared }: AppProps) {
  return (
    <html lang="en">
      <head>
        <Head />
      </head>
      <body>
        <div id="vessel">{children}</div>
        <Scripts nonce={(shared as { nonce?: string }).nonce} />
      </body>
    </html>
  );
}
```

Prefer declaring `nonce` on `SharedContext` so the cast is unnecessary; see the `load-page-data` topic. If no prop is supplied, `<Scripts />` falls back to the framework's request nonce slot.

**This is the same nonce a `Content-Security-Policy` header would enforce.**
`@warlock.js/core`'s opt-in `http.csp` (5.12.0 — see its `configure-app` and
`send-response` skills) builds `script-src 'self' 'nonce-<value>'` from the
identical per-request `request.nonce`. The framework's own emitted
`<script>` tags — the payload script and the hydration client entry module,
both rendered by `<Scripts />` — already carry that nonce automatically;
nothing in an app's `root.tsx` needs to change to make those two work
together. The prop above only matters if your root renders its OWN inline
`<script>` tags that need to pass the same policy.

`<Scripts />` owns both the inline data payload and the hydration client
entry module — Stage 1 streaming SSR moved the entry module off a post-render
string splice and onto real React output, read from the same document
context the payload script already reads (`hydrationClientModuleUrl`). Its
published `esm/hydration/index.mjs` file is a build input and must never be
imported by application code.

## Add an application loader

```ts title="src/web/root.setup.ts"
import type { AppLoader } from "@warlock.js/web";

export const loader = (async () => {
  return { applicationName: "Warlock Store" };
}) satisfies AppLoader;
```

```tsx title="src/web/root.tsx"
import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";
import type { loader } from "./root.setup";

export default function App({ data, children }: AppProps<typeof loader>) {
  return (
    <html lang="en">
      <head>
        <Head />
        <meta name="application-name" content={data.applicationName} />
      </head>
      <body>
        <div id="vessel">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
```

The App loader runs first and is awaited before the outermost layout loader starts; matched layout loaders then run outermost to innermost before the page loader. Its return is for the App component; use `shared` for request data that multiple levels need.

## Root middleware and Strict Mode

Use the optional root config for guards that must run before layout and page
middleware:

```ts title="src/web/root.setup.ts"
import type { RootConfig } from "@warlock.js/web";
import type { Middleware } from "@warlock.js/core";

declare module "@warlock.js/core" {
  interface RequestLocals {
    startedAt?: number;
  }
}

const attachRequestContext: Middleware = ({ request }) => {
  request.locals.startedAt = Date.now();
};

export const config: RootConfig = {
  middleware: [attachRequestContext],
  strictMode: true,
};
```

`loader` and `register` are setup exports; `ErrorBoundary` is a UI component. Named
`sitemap` or route-policy exports are invalid. Root metadata may be static or a
server-only callback; it participates in title and field composition with
layouts and the page. A callback returns the root's complete level: explicit
fields override `child.metadata`, while omitted child fields are not retained. Preserve
descendant metadata deliberately by spreading `child.metadata`:

```ts title="src/web/root.setup.ts"
import type { RootConfig } from "@warlock.js/web";

export async function loader() {
  return { applicationName: "Acme" };
}

export const config = {
  metadata: ({ data, child }) => ({
    ...child?.metadata,
    title: `${data.applicationName} | ${child?.metadata.title ?? "Home"}`,
  }),
} satisfies RootConfig<typeof loader>;
```

The callback may override a child title; an absolute child title remains
authoritative. Static root metadata still merges with child metadata.

`strictMode` defaults to `false`, preserving existing applications. New Web
scaffolds enable it with `strictMode: true`. The root owns this setting even
though the document component is not mounted in the browser: Warlock projects
the flag into hydration and wraps the complete page, layout, and navigation
tree beneath `#vessel` in React `StrictMode`.

Strict Mode's development checks can run effects and their cleanup an extra
time, so make client setup and cleanup idempotent. These extra checks do not run
in production.

## Gotchas

- **The root owns the complete document.** Return `<html>`, `<head>`, and `<body>`, not a fragment.
- **Keep `{children}` inside `#vessel`.** Server rendering can still look correct without it, but hydration cannot mount.
- **Render `<Head />` in a custom root.** It is what turns the page's `metadata` into elements.
- **Render `<Scripts />` in a custom root.** Without the payload script, the browser cannot hydrate the server-rendered page.
- **Do not make the component `async`.** Load data with `AppLoader`.
- **Do not import browser-only state into the root expecting it to persist.** The client hydrates the subtree inside the root, not the root itself.
- **Stylesheet links are installed separately.** They are inserted before `</head>`; read the `serve-styles` topic for the dev/production rules.

## See also

- The `create-a-page` topic: the Page level rendered under the root.
- The `use-layouts` topic: the persistent wrapper inside `#vessel`.
- The `load-page-data` topic: `AppLoader` and typed `shared`.
- The `serve-styles` topic: global CSS from `root.tsx`.

## Override the default viewport

```ts title="src/web/viewport.setup.ts"
import type { PageConfig } from "@warlock.js/web";

export const config = {
  route: "/viewport",
  metadata: { viewport: "width=device-width, initial-scale=1, viewport-fit=cover" },
} satisfies PageConfig;
```

```tsx title="src/web/viewport.page.tsx"
export default function ViewportPage() {
  return <main>Viewport settings come from metadata.</main>;
}
```

`<Head />` emits a default viewport even without this override. Remove a manual
duplicate tag from `root.tsx`; use `viewport: false` only when intentionally
suppressing it.
