# 5.36.0 plan — Vite family refresh (owner-approved 2026-10-21)

First release of the post-5.34 dependency refresh (one family per release).

- Upgrade `vite` 7.3 → 8.x, `vitest` 4.1 → 5.x and `@vitejs/plugin-react` 5 → 6 together, in the monorepo and the
  create-warlock template; widen `@warlock.js/web`'s `vite` peer range.
- Verify every Warlock Vite plugin and the dev-server module loading on Vite 8 (page registry, setup-file
  projection, fonts, performance budgets, client build manifest) and the test kit on Vitest 5 (setupTest,
  worker lifetime, projects layout).
- Upgrade the docs site to Astro 7 with `@astrojs/mdx` 8; drop the explicit `markdown.gfm` workaround once MDX
  tables render without it (the docs table guard proves it).
- Upgrading notes, a `warlock upgrade --from 5.35 --to 5.36.0` codemod for app config changes, and one full
  validation.
