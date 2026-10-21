---
description: 'React SSR pages with Vite: `Link`, `href`, `defer`, `shared`, `useShared`, `Form`, `Head`, `Image`, `useTrans` and `navigateTo`. Use for "add a page", "load page data", stream loaders, layouts, forms/actions, sessions, themes, localization, metadata or sitemaps. Not this package → @warlock.js/core for API routes, mail and storage; @warlock.js/cascade for queries; @warlock.js/seal for input validation.'
---

# @warlock.js/web

Web adds an SSR React page layer to a Warlock app. Pages live under `src/web/**` as `*.page.tsx` files; their matching `.setup.ts` files declare configuration and fetch data in named loaders. The server renders the shell, the browser hydrates, and navigation verbs re-run loaders through the server. There is no client-side route matcher; the server decides what matched.

## The 80% path

1. Install the layer with `warlock add web` (`add-web-to-an-app.md`), then edit the document in `src/web/root.tsx` (`write-the-root.md`).
2. Separate UI and logic with `use-page-setup-files`, then create pages with `config` and a loader (`create-a-page.md`, `load-page-data.md`, which also covers how loader data is typed on the page); wrap them with `use-layouts.md`; set titles, descriptions, Open Graph and per-locale metadata (`set-page-metadata.md`).
3. Link and navigate with `<Link>`, `href()`, `navigateTo` (`navigate-on-the-client.md`).
4. Post forms to a Core API route (`submit-a-form.md`), then `refresh()` to revalidate (a route whose handler declares `responseSchema` types `data` and `onSuccess`); or handle a form on the page itself with an `action` export and `<Form>` (`handle-a-form-action.md`). Keep feedback, pending states and motion correct with `preserve-feedback-and-motion.md`.
5. Guard pages and read the user (`protect-a-page.md`); a `requireUser()`-guarded page is typed as signed-in (`useUser("route.name")` is non-null).
6. Translate pages (`localize-pages.md`), then build RTL and mixed-direction layouts (`build-rtl-and-mixed-direction-ui.md`); stream slow data (`stream-deferred-data.md`).
7. Polish: styles (`serve-styles.md`), self-hosted fonts (`use-web-fonts.md`), sitemap and robots (`generate-sitemap.md`), themes (`multi-theme.md`), multi-site apps (`multi-site.md`), client-only UI and hydration debugging (`render-client-only.md`), images (`render-images.md`), vitals (`measure-web-vitals.md`).
8. Build form controls with `build-accessible-controls` (the app design-system, keyboard/focus, RTL and date semantics).
9. Test page loaders, actions and rendering (`test-a-page.md`).
10. Observe SSR phases and deferred values with `TracingHooks` (`observe-page-requests.md`).

## Conventions and pitfalls

- Put components in UI files; put `config`, `loader`, `register`, and `action`/`actions` in the matching setup file.
- Route, cache, validation, middleware, metadata and sitemap policy go in `config`; keep loaders for data only.
- Anything the browser receives via `shared` must be declared by augmenting `SharedContext` in module `"@warlock.js/web"`.
- Server-only helpers live on subpaths (`@warlock.js/web/build`, `/sitemap`, `/form`, `/connector`); importing them from the root barrel breaks page graphs.
- Only `PublicPageError` messages reach the browser in production; other errors are sanitized.
- Cascade is server-only: value-importing it in client code fails the build (type imports are fine).
- Do not add a client router or matcher; two matchers diverge silently.
