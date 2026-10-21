# Design system source

The UI primitives are copied from the official shadcn/ui new-york-v4 registry:
https://ui.shadcn.com/r/styles/new-york-v4/{component}.json (retrieved 2026-10-21).
Their MIT license is retained in `src/web/components/ui/LICENSE.md`. Calendar's
focus effect is extracted to `use-calendar-day-button`.

The registry declares `radix-ui` for Button, Checkbox, RadioGroup, Switch,
Popover, Dialog and Label; `cmdk` for Command; and `react-day-picker` plus
`date-fns` for Calendar. The registry's floating day-picker dependency is pinned
to the verified 9.14.0 API (single selection, autoFocus, dir). All runtime versions
in package.json were verified with `npm view` on 2026-10-21. `cn`,
class-variance-authority and lucide-react are the registry's styling dependencies.

The form adapters use the installed Mongez React Form source contract:
`useFormControl`, `changeValue`, `setChecked`, `onBlur`, `inputRef`,
`visibleElementRef`, reset/clear subscriptions and `useSubmitButton`.
Forms use the library's `Form` directly; it supplies `noValidate`.

Edit this template, format its files, then run
`node packages/create-warlock/scripts/sync-design-system.mjs` from the repository
root and format the resulting Core payload. The integrity spec compares every
file and dependency so the add command and scaffolder cannot drift.
