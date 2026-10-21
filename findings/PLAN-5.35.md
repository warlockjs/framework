# 5.35.0 plan (owner-approved 2026-10-21)

Sources: findings/FRAMEWORK_ISSUES.md (DW-01..15), findings/WEB_SKILLS_IMPROVEMENTS.md, and the code-quality,
design-system, AI-workflow and performance-budget decisions. Everything ships in 5.35.0.

| Stream | Scope |
| --- | --- |
| check | `warlock check` web rules (component file size, one component per file, state/effects outside hooks, native select/checkbox/radio/date, native validation attributes on DOM inputs,), `responseSchema` required on controllers, `--changed`, `--fix` |
| inspect | `inspect` `files` section (module map, roles, import graph) and `warlock explain <file>` (keeps `explain <CODE>`) |
| design-system | `src/web/design-system` (Tailwind + shadcn or full-stack option in create-warlock, plus `warlock add design-system`): TextInput, EmailInput, PasswordInput, TextareaInput, SelectInput (search), MultiSelectInput, DatePickerInput, TimePickerInput, DateTimePickerInput, CheckboxInput, RadioInput, SwitchInput, FileInput, SubmitButton; accessible-controls skill |
| web-generators | `warlock generate page`, `generate form` (design-system inputs + shared seal schema, optional endpoint), CRUD UI for a module |
| api | typed `AppError` base used by `http.errorResponse`, list-endpoint helper, contract tests from `responseSchema` |
| budgets | per-page JS/CSS budgets in `warlock build` (report, `--json`, fail/warn) |
| e2e | `assertAccessible()` (axe-core), starter e2e at 390/1280, reproduce+fix DW-11, DW-12 |
| runtime | DW-13 session install on refresh/locale/swap, DW-06 resource derivation from hidden fields, DW-01, DW-02, DW-03, DW-05, DW-07 |
| auth | DW-15, DW-09, DW-08, DW-10 |
| skills | WEB_SKILLS 2.2, 2.4, state-ownership rule, RTL topic, feedback/motion topic (no-JS form work and Mongez changes are out of scope) |
