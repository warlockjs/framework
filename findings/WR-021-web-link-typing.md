# WR-021: Web link typing

Package: `@warlock.js/web` 5.29.0.
Classification: typing request.

`Omit<LinkProps, ...>` collapses the destination union (route name versus
`/...` literal), so wrapper components need a distributive omit
(`src/web/ui/link-props-without.type.ts`). Data-driven route names, as in the
shortcut descriptors, need `runtimeRoute(name)`. Request: export a
distributive props helper and a typed runtime route-name guard.

Additional WR-001 evidence (2026-10-15): after the tree roughly doubled to
about 210k runtime lines and about 970 specs, `tsc --noEmit` and ESLint
(type-aware) both exceed an 8 GB heap. Bureau raised `lint`, `build` and `tsc`
to 16 GB.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
