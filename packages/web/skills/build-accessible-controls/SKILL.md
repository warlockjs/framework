---
name: build-accessible-controls
description: "Use the app design-system Mongez controls for accessible forms: searchable selections, radio/checkbox/switch states, calendar dialogs, explicit ids, keyboard navigation and focus return. For endpoint submission use submit-a-form."
---

# Build accessible controls

The design-system has two kits with one contract (same component files, props, hooks
and error display): shadcn/Tailwind, the default, and Mantine, installed with
`npx warlock add design-system --kit mantine` and described in the
`use-the-mantine-kit` topic. The keyboard and Radix details below describe the shadcn
kit; Mantine's widgets follow Mantine's own accessibility behavior.

For Tailwind apps, run `npx warlock add design-system`. If Tailwind is missing,
first run `npx warlock add tailwind`. The installer refuses before changing an
unconfigured app and preserves existing files. `npm create warlock@latest app --
--stack=web` includes the controls by default; an explicit `--features` replaces
the preset, and selecting `shadcn` includes the design system.

Use `Form` directly from `@mongez/react-form` (it renders `noValidate`). Do not
create a competing form owner or use native browser validation attributes.

```tsx
import { Form } from "@mongez/react-form";
import EmailInput from "web/design-system/components/email-input";
import MultiSelectInput from "web/design-system/components/multi-select-input";
import SubmitButton from "web/design-system/components/submit-button";

export default function PreferencesForm() {
  return (
    <Form>
      <EmailInput id="preferences-email" name="email" label="Email" hint="For receipts" />
      <MultiSelectInput
        id="preferences-topics"
        name="topics"
        label="Topics"
        options={[
          { value: "news", label: "News" },
          { value: "events", label: "Events" },
        ]}
      />
      <SubmitButton id="preferences-submit" name="submit" label="Save" />
    </Form>
  );
}
```

Import each default export by its web alias, without barrels:
TextInput, EmailInput, PasswordInput, TextareaInput, SelectInput,
MultiSelectInput, DatePickerInput, TimePickerInput, DateTimePickerInput,
CheckboxInput, RadioInput, SwitchInput, FileInput and SubmitButton live in
`web/design-system/components/<kebab-name>`. Hooks live in
`web/design-system/hooks/use-<name>` and props in `web/design-system/types`.

Every control requires `id`, `name`, and `label`. Give repeated forms distinct,
stable id prefixes. Options have unique stable string `value`s and string
`label`s, plus optional `disabled`. Option ids derive from values so reordering
options does not change identity. Do not generate random ids during render.
Hints and errors reference `${id}-hint` and `${id}-error`; errors are announced.
Use `schema`/`rules` and `validateOn` for Mongez validation. External errors use
`error`; the server must validate independently.

## Keyboard and focus

- SelectInput and MultiSelectInput open with Enter/Space on their trigger and
  focus a searchable combobox. Arrow keys, Home/End move its active option;
  Enter selects. Multi-selection toggles with Enter, or Space while search is
  empty. Selection stays independent of search. Disabled options are skipped;
  an empty result is announced. Escape dismisses and Radix returns focus to
  the trigger. Clear writes `""` for single choice or `[]` for multiple choice.
- CheckboxInput and SwitchInput use Radix keyboard behavior and Mongez
  `type: "checkbox"`, `checked` and `setChecked`; unchecked values collect false.
  Checked states have a visible indicator/background, focus has a ring, and
  disabled states have reduced opacity. Do not communicate state by color alone.
- RadioInput registers one Mongez scalar for the whole RadioGroup. Tab enters
  the group; arrows move selection, respecting `dir="rtl"`. Each item has its
  own label and a visible selected indicator. Use `value` or `defaultValue` to
  choose its string value. Clearing the group produces `""`.
- Date controls open a modal Popover dialog with a labelled calendar grid.
  DayPicker owns arrow/day/week/month navigation and initial focus. Escape or
  Close returns focus to the trigger. Clear writes `""`. Preserve the modal
  focus trap; do not replace it with an unlabelled positioned div.
- FileInput supplies File or File[] to Mongez and clears the browser input on
  reset/clear. A browser cannot restore an initial file selection, so its reset
  baseline is always empty. SubmitButton follows the owning form's submission
  state and excludes itself from collected values.

Keep event adaptation, state and effects in hooks. Preserve `inputRef`,
`visibleElementRef`, disabled state, blur validation, and error descriptions
when changing a widget. A ref must point at a focusable widget, not a hidden
submission input. Popups also need their own accessible name. Keep visible text,
search/clear/close labels and placeholders localized; pass `dir` to portalled
widgets because they do not inherit the field wrapper's direction.

## Date versus instant

DatePickerInput stores a calendar date (`YYYY-MM-DD`), TimePickerInput stores a
wall-clock time (`HH:mm`), and DateTimePickerInput stores a local wall-clock
value (`YYYY-MM-DDTHH:mm`). These are strings, not UTC instants. DateTime starts
at midnight when a date is chosen without a time; clearing its time clears the
value. Resolve timezone and daylight-saving policy explicitly in the service
before converting to an instant. Never use `toISOString().slice(0, 10)` for a
calendar date: timezone conversion can select a different day.

When extending the kit, follow the WAI-ARIA APG
[combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/),
[listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/),
[checkbox](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/),
[radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/),
[switch](https://www.w3.org/WAI/ARIA/apg/patterns/switch/), and
[date dialog/grid](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)
patterns. Test focus entry/return, keyboard interaction, checked/selected states,
validation, clearing/reset, repeated forms and RTL in the app's browser suite.
