# WR-007: Optional discriminated unions reject omitted fields

Package: `@warlock.js/seal` 5.29.0; Node 22.13.0.

Expected: `.optional()` accepts an absent field or explicit `undefined`, while
validating a supplied tagged object and still rejecting `null` unless separately
nullable. Actual: the absent and explicit-undefined cases both fail with
`Expected object with discriminator field "kind"`. A supplied valid branch
passes; `null` correctly fails. Wrapping the same tagged schema in a single-member
ordinary union makes the absent optional field pass.

Minimal owned reproducer, run from this project:

```sh
node --input-type=module <<'JS'
import { v, validate } from '@warlock.js/seal';
const tagged = () => v.discriminatedUnion('kind', [
  v.object({ kind: v.literal('alpha'), value: v.string() }),
  v.object({ kind: v.literal('beta'), count: v.int() }),
]);
const direct = v.object({ entry: tagged().optional() });
const wrapped = v.object({ entry: v.union([tagged()]).optional() });
console.log((await validate(direct, {})).isValid); // false: defect
console.log((await validate(wrapped, {})).isValid); // true: workaround
console.log((await validate(direct, {
  entry: { kind: 'alpha', value: 'owned-fixture' },
})).isValid); // true: supplied-branch control
JS
```

Source: `esm/validators/discriminated-union-validator.mjs`, `validate()` around
line 70, handles nullable input and then requires a plain object without handling
the inherited optional flag. This report establishes the optional behavior only;
other modifier combinations have not been qualified.

Impact/workaround: Bureau's optional workspace directory directive already uses
`v.union([workspaceDirectoryDirectiveSchema]).optional()` in
`src/app/workspaces/schema/workspace-mutation.schema.ts`. Retain that wrapper
until the upstream fix passes absent/undefined, required-field, valid/invalid
branch and null/nullable regression cases. Do not replace object-to-object tagged
dispatch with an ambiguous multi-member ordinary union.

Evidence: primary independently ran five controls in
`.tmp/coordinator/stage12/seal-optional-union-repro.json`; the secondary runtime
lane rediscovered the same installed behavior. This is one consolidated finding,
separate from WR-001's compiler-memory performance request.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
