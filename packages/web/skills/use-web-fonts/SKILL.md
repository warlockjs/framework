---
name: use-web-fonts
description: "Declare self-hosted fonts in web.fonts with metric-matched fallbacks, critical preloads and hashed immutable assets. Use for hero heading layout shifts, font-display swap, WOFF2, font variables, or fontPreload route policy."
---

# Use web fonts

Declare fonts in `src/config/web.ts` and use the generated CSS variable.
Read the existing root and font declarations before editing. Remove equivalent
handwritten `@font-face` declarations when migrating; keep unrelated CSS.

A condensed display font swapping in late reflowed a hero heading onto two
lines with the wider fallback. Preloading fetches earlier; a metric-matched
local fallback approximates both width and line height before the file arrives.

## Complete example

Prerequisite: an app with `webConnector()` installed and a licensed WOFF2
file at `src/fonts/display-regular.woff2` (font binaries are app assets).

```ts title="src/config/web.ts"
import type { WebConfigurations } from "@warlock.js/web";

export default {
  fonts: [
    {
      family: "Display",
      variable: "--font-display",
      fallback: ["Arial", "Helvetica"],
      display: "swap",
      files: [
        {
          path: "src/fonts/display-regular.woff2",
          weight: 400,
          style: "normal",
          preload: true,
          aboveFold: true,
        },
      ],
    },
  ],
} satisfies WebConfigurations;
```

```tsx title="src/web/root.tsx"
import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";
import "./app.css";

export default function App({ children }: AppProps) {
  return (
    <html lang="en">
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

```css title="src/web/app.css"
.hero h1 {
  font-family: var(--font-display);
  font-size: clamp(3rem, 8vw, 7rem);
  line-height: 1;
}
```

```tsx title="src/web/index.page.tsx"
import type { PageConfig } from "@warlock.js/web";

export const config = {
  route: { path: "/", name: "home" },
} satisfies PageConfig;

export default function HomePage() {
  return (
    <section className="hero">
      <h1>Make room for bold ideas</h1>
    </section>
  );
}
```

## Route policy

An optional page/layout/root `config.fontPreload: false` suppresses all font
preloads for its document; any ancestor's opt-out wins. CSS remains linked for
client navigation. For example, a route without the hero:

```tsx title="src/web/about.page.tsx"
import type { PageConfig } from "@warlock.js/web";

export const config = { fontPreload: false } satisfies PageConfig;

export default function AboutPage() {
  return <main>About this site</main>;
}
```

## Options and verification

- Paths are relative to the app root (`src/fonts/…` or `public/…`), not URLs.
- Families require unique `family` and `variable`. Each file supports `weight`
  (400 by default, or a range such as `"100 900"`), `style`, `unicodeRange`,
  `preload`, `aboveFold`, and optional equivalent TTF/OTF `metricsPath`.
- `display` defaults to `swap`. `fallback` accepts Arial, Helvetica, Times New
  Roman, Segoe UI, Roboto, or an array. Use names from this recorded set.
- Use the CSS variable; naming only the real family bypasses the adjusted stack.
- Inspect initial HTML: one cross-origin font preload per critical URL and a
  stylesheet link appear inside the head in development and production.
- Inspect a production font response: hashed `/assets/font-…` URL,
  `Cache-Control: public, max-age=31536000, immutable`. Unhashed public URLs
  retain their usual policy. No automatic conversion: supply WOFF2 yourself.
- Dev warnings identify TTF/OTF and critical faces missing preload/fallback.
- Metrics use Capsize's weighted Latin sample and recorded system-font data
  (MIT attribution in `src/fonts`). Width matching is approximate; test the
  actual hero at its breakpoints with an empty browser cache. Variable fonts
  use default-instance metrics; non-Latin sampling is not implemented.
