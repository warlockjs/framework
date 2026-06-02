# 2026-05-29 — Seal docs review findings

**Source:** Opus review agent, read-only audit of published Starlight docs vs `@warlock.js/seal/src` + skills.
**Scope of fix (separate session):** apply in lockstep — docs **and** skills + llms regen + build-verify. Read `domains/shared/skills/update-package/SKILL.md` first.

Paths:
- Docs: `@warlock.js/docs/src/content/docs/v/latest/seal/`
- Source: `@warlock.js/seal/src/`
- Skills: `@warlock.js/seal/skills/`

## Axis 1 — Documentation quality & drift

**HIGH — invented `.attribute(name, displayName)` method.** No such method. Source defines only `.attributes(attributes: Record<...>)` — plural, takes an object (`base-validator.ts:278`). The documented form `v.object({...}).attribute("email_address", "Email Address")` will not compile. Fix → `.attributes({ email_address: "Email Address" })` (verify against `attributesText` merge logic). Locations:
- `essentials/05-errors.md:133-139` (`## Field display names — .attribute()`)
- `essentials/02-modifiers.md:181-190` (`## .attribute(name, displayName)`)
- `guides/handle-errors.md:168-174` + cross-link `:240`
- `guides/compose-modifiers.md:169-176`
- **SKILLS** (drifted too): `seal/skills/compose-seal-modifiers/SKILL.md:219`, `seal/skills/handle-seal-errors/SKILL.md:114`

**MED — wrong error shape in a code comment.** `recipes/optional-fields.md:148` shows `errors: [{ key: "username", rule: "min", ... }]`. Real `result.errors[]` shape is `{ type, error, input }` (`key`/`rule` are response-DTO names used elsewhere, not the raw shape). Fix → `[{ type: "min", error: "...", input: "username" }]`.

**MED — `kind` instead of `type` (project convention).** `recipes/recursive-schemas.md:94-95` (+ inner `v.literal` field names at `:101`, `:108`) uses `kind`. Project mandates `type` everywhere. Fix → rename `kind` → `type`.

**Confirmed fixed:** the `result.validData`/`error.rule` → `result.data`/`error.type` drift is gone across all pages. Everything else (v.* primitives, all modifiers, object methods, date/boolean rules, ID methods, JSON-Schema targets, `Infer`/`Infer.Input`/`Infer.Output`, plugin + config API, `firstErrorOnly` default `true`) verified accurate.

## Axis 2 — Broken links
Clean. Subdir pages use `../<section>/<file>.md`; index uses `./<section>/<file>`. All resolve. No abandoned-layout rot, no `domains/` leaks.

## Axis 3 — Sidebar & DX
Clean. `pkgTopic({ slug: "seal", sections: fullSections })` (`astro.config.mjs:83`); all five dirs exist, every page has `sidebar.order`+`label`; overview at order 0.

## Priority
`.attribute()` → `.attributes()` across 4 docs **+ 2 skills** is the must-fix (drift that leaked into skills). The `kind`→`type` + error-shape comment are quick follow-ons.
