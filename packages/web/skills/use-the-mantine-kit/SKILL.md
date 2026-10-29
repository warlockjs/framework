---
name: use-the-mantine-kit
description: 'Choose and use the Mantine kit of the app design-system: `warlock add design-system --kit mantine` (or `warlock add mantine`), no Tailwind needed, same component names, props and hooks as the shadcn kit, bound to Mongez React Form. Covers setup (PostCSS preset, provider and colour scheme in `root.tsx`), the theme file, validation errors through Mantine `error`, `notify` and `notifyOnSubmit` with `useSubmitForm`/`useSubmitAction`, `confirm()`, `PaginatedTable`, and switching kits. Triggers: `mantine`, `--kit mantine`, `--ui=mantine`, `MantineProvider`, `ColorSchemeScript`, `mantine-theme.ts`, `notifyOnSubmit`, `PaginatedTable`, "use Mantine", "switch from shadcn". Skip: the shared control contract and accessibility rules — the `build-accessible-controls` topic; Tailwind and shadcn setup — the `serve-styles` topic; submitting to an endpoint — the `submit-a-form` topic; `@mantine/form`, which this kit never uses.'
---

# Use the Mantine kit

The design system has two kits behind one contract: shadcn/Tailwind and Mantine. The
file names under `src/web/design-system/components/`, their props, the hooks in
`src/web/design-system/hooks/` and the way a validation error is shown are the same, so
pages, generated forms (`warlock generate form`) and these topics work with either.
Pick one per app; they exclude each other.

## Install

```bash
npx warlock add design-system --kit mantine   # or: npx warlock add mantine
npx create-warlock my-app --stack=web --ui=mantine
```

`--kit` and `--ui` take `shadcn` (the default) or `mantine`; `--ui` also takes `none`.
The Mantine kit does not require Tailwind. The command refuses before changing
anything when the other kit is installed (detected from files and dependencies) and
prints how to switch. It installs exact versions of `@mantine/core`, `hooks`, `dates`,
`notifications`, `modals` and `dayjs`, plus `postcss-preset-mantine` and
`postcss-simple-vars` as dev dependencies (Mantine 9 needs React 19.2, which
`warlock add web` already installs), and:

- writes `postcss.config.mjs` (skipped, with printed instructions, when a PostCSS config
  exists) and puts Mantine's `@import`s at the top of `src/web/app.css`;
- edits `src/web/root.tsx` once: `import "./app.css"`, `{...mantineHtmlProps}` on
  `<html>`, `<DesignSystemColorScheme />` after `<Head />`, and `<DesignSystemProvider>`
  around the `#vessel` div. A root with another shape is left untouched and the lines are
  printed.

The provider mounts `MantineProvider`, `ModalsProvider` and `Notifications`. The colour
scheme script runs before paint and `mantineHtmlProps` suppresses the expected `<html>`
attribute difference, so hydration is clean; Mantine renders on the server, so no
`.client` file or `ClientOnly` is needed.

## Theme

Edit `src/web/design-system/mantine-theme.ts` (`createTheme`: primary colour, radius,
fonts, spacing) and `defaultColorScheme`. Do not duplicate tokens in CSS.

## Forms

Use the controls exactly as in `build-accessible-controls`: default exports from
`web/design-system/components/<kebab-name>`, required `id`, `name` and `label`, inside
`Form` from `@mongez/react-form`. Mantine owns the invalid styling: Mongez or server
errors reach the input through Mantine's `error` prop, `hint` is its `description`,
`required` shows the asterisk and never the native attribute. Stored values match the
shadcn kit (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm`, string or string array, boolean).

Never install or import `@mantine/form`: Mongez React Form owns values, validation and
submission, and `useSubmitForm`/`useSubmitAction` are built on it.

## Notifications, confirm and tables

```tsx
import { useSubmitForm } from "@warlock.js/web/form";
import { notifyOnSubmit } from "web/design-system/notify";

const { submit } = useSubmitForm({
  route: "contact.send",
  ...notifyOnSubmit({ success: "Message sent" }),
});
```

`notifyOnSubmit({ success, error? })` returns `onSuccess` and `onError` callbacks that fit
both submit hooks; without `error` the server message is shown. `notify.success`,
`notify.error`, `notify.info` and `notify.warning` show a toast from any handler, and
`messageFrom(result)` extracts the message. `confirm({ message, title?, danger? })` from
`web/design-system/confirm` resolves a boolean through a Mantine modal.
`web/design-system/components/paginated-table` renders `rows` and the `pagination` block
(`page`, `pages`) a Warlock list endpoint returns; `onPageChange(page)` loads the page.

## Switching kits

Follow the refusal message: to leave shadcn remove `components.json`,
`src/web/components/ui` and `src/web/design-system` and uninstall its packages; to leave
Mantine remove `src/web/design-system`, `postcss.config.mjs` and the Mantine imports in
`app.css` and `root.tsx`. Then run `warlock add design-system --kit <kit>`.
