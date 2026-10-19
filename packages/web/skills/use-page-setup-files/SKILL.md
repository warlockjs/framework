---
name: use-page-setup-files
description: "Separate page, layout, root, and error setup from UI. Use for .setup.ts pairs, config, loaders, actions, metadata, universal register(), type-only loader imports, duplicate exports, and setup-file development changes."
---

# Warlock — page setup files

Page logic belongs in `.setup.ts`; React components belong in the UI file.
A setup file is needed when a page has logic. A component-only page needs no
setup file.

| UI file                  | Setup file               |
| ------------------------ | ------------------------ |
| `about.page.tsx`         | `about.setup.ts`         |
| `products/[id].page.tsx` | `products/[id].setup.ts` |
| `layout.tsx`             | `layout.setup.ts`        |
| `root.tsx`               | `root.setup.ts`          |
| `error.page.tsx`         | `error.setup.ts`         |
| `404.page.tsx`           | `404.setup.ts`           |

The UI file owns the default component and any named component such as
`ErrorBoundary`. Setup files own `config`, `loader`, `register`, and page
`action` or `actions`. Metadata always belongs in `config.metadata`. Each role keeps its own config type:
`PageConfig`, `LayoutConfig`, or `RootConfig`. Actions belong to ordinary pages;
error and not-found pages retain their special rendering contracts.

## A complete pair

```ts title="src/web/about.setup.ts"
import { groupedTranslations } from "@mongez/localization";
import type { PageConfig } from "@warlock.js/web";

export async function loader() {
  return { teamName: "Acme" };
}

export const config = {
  route: { path: "/about", name: "about" },
  metadata: ({ data }) => ({
    title: `About ${data.teamName}`,
    description: "Meet our team.",
  }),
} as const satisfies PageConfig<typeof loader>;

export function register() {
  groupedTranslations({ team: { en: "Our team", ar: "فريقنا" } });
}
```

```tsx title="src/web/about.page.tsx"
import { useTrans, type PageProps } from "@warlock.js/web";
import type { loader } from "./about.setup";

export default function AboutPage({ data }: PageProps<typeof loader>) {
  const trans = useTrans();
  return (
    <h1>
      {trans("team")}: {data.teamName}
    </h1>
  );
}
```

`import type { loader } from "./about.setup"` retains
`PageProps<typeof loader>` inference without adding setup to the UI runtime
graph. Use type-only imports for action inference too. Do not value-import or
dynamically import setup from UI code.

## Server and browser work

Loaders, actions, metadata callbacks, and config policy run on the server.
Metadata may be a static object or a function of loader data. Resolved metadata
reaches the server-rendered head, hydration payload, and client navigation.
Layout and root metadata compose with page metadata. Use `config.metadata`
for both the static object and function forms; `PageConfig<typeof loader>`
checks the callback and infers its data.

`register()` still runs in both realms, once per module namespace before
middleware and loaders. It is synchronous and must not return a Promise. The
framework projects browser-safe registration code and its dependencies to the
client. Keep registration safe for both realms; server-only services belong
in loaders or actions.

## Duplicate declarations and development

Every logic export has one owner. Duplicates fail with the export name and
source files; the framework never silently chooses a winner. Default
components and named component exports belong in the UI file.

`warlock dev` picks up setup-file additions, edits, and deletions. Route changes
update the route graph; setup edits refresh server logic and its client
registration projection. Component-only edits remain eligible for Fast Refresh.
