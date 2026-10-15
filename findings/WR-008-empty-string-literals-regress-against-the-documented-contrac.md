# WR-008: Empty string literals regress against the documented contract

Package: `@warlock.js/seal` 5.29.0; Node 22.13.0.

Expected: a required `v.literal("")` accepts a present empty string, rejects
missing input and rejects other values. The installed `pick-seal-primitive`
skill explicitly documents that behavior and says it was fixed in 4.9.2.
Actual: the required literal rejects `""` as missing; `.present()` also rejects
it. `.optional()` accepts both `""` and `null` but drops the supplied field from
validated data. Nonempty literal and `v.string().present()` controls pass.

Run this minimal reproducer from the installed project:

```sh
node --input-type=module <<'JS'
import { v, validate } from '@warlock.js/seal';
console.log(await validate(v.object({ alt: v.literal('') }), { alt: '' }));
// invalid: required, contrary to the documented empty-literal contract
console.log(await validate(v.object({ alt: v.literal('').optional() }), { alt: '' }));
// valid, but data is {}: supplied empty value is lost
console.log(await validate(v.object({ alt: v.string().present() }), { alt: '' }));
// valid, data is { alt: '' }
JS
```

Installed source: `esm/validators/literal-validator.mjs`, constructor assigns
`blankIsMissing = true` unconditionally. Documentation:
`.codex/skills/warlock-js-seal-pick-seal-primitive/SKILL.md`, empty-literal section.

Impact/workaround: present empty values are meaningful in native forms and
metadata. Bureau's existing outer `v.union([v.literal(""), otherSchema]).present()`
fields passed independent empty/invalid controls and preserve the supplied empty
value; do not replace these with `.optional()`. The metadata reader uses an
explicit present-string schema when empty versus absent must stay distinct.
No dependency edit was made. Upstream should restore the documented distinction
and cover required, present, optional, null, missing and union cases.

Evidence: nine independent primary controls in
`.tmp/coordinator/stage15/seal-empty-literal-repro.json`; the secondary metadata
lane's initial owned reproduction agrees. This is separate from WR-007.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
