# Mantine design system source

The Mantine kit implements the same design-system contract as the shadcn kit
(`../design-system`): the same component file names, props, hooks and
validation-error display, bound to `@mongez/react-form`. `@mantine/form` is not
used and must not be installed; Mongez React Form owns values, validation and
submission.

Shared, kit-agnostic files are authored in `../design-system` and mirrored here
byte for byte by `scripts/sync-design-system.mjs` (see `SHARED_FILES`):
`hooks/use-control`, `use-date-control`, `use-file-control`, `use-select-control`,
`use-submit-control` and `types/control-props`. Do not edit the copies here.

Kit-owned files: every file in `components/`, `mantine-theme.ts`, `provider.tsx`,
`notify.ts` and `confirm.ts`.

Versions are exact pins of the latest stable Mantine release that is at least two
weeks old, verified with `npm view` on 2026-10-29. Mantine 9 requires React 19.2,
which `warlock add web` installs. `postcss-preset-mantine` and
`postcss-simple-vars` are build-time only.

Edit this template, format its files, then run `node scripts/sync-design-system.mjs`
from `packages/create-warlock`. The integrity spec fails when a payload is stale.
