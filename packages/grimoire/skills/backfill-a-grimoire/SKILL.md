---
name: backfill-a-grimoire
description: "Write the Grimoire for a project that already has code but no `grimoire/` folder: build the book, propose features from the modules and routes, write them as inferred, and bring the owner the questions only they can answer. Use once per existing project, or when a large undescribed area is found."
---

# Backfill a Grimoire

The Grimoire is experimental: its file structure and commands may still change.

The code exists; the description does not. You will infer intent from code, and inference can be
plausible and wrong. So everything you write here is marked **inferred** until the owner confirms
it, and you bring them questions instead of guessing.

## 1. Build the book

```bash
npx warlock grimoire build
```

It needs no writing. Read the module summaries (`grimoire/book/app/<module>/index.md`), the
route list (`grimoire/book/app/routes.json`) and each site's page list.

## 2. Propose the features

Start from the modules: a module is usually one feature. Then adjust.

- Two modules that cannot be described without each other → one feature with both `folders`.
- A module that does two unrelated things → two features; tag the files of the smaller one.
- A folder shared by several features (a `components` folder with files of each) → list the files
  each feature owns in its `folders`, one entry per file (`folders: [src/app/auth, src/web/components/login-form.tsx]`),
  instead of tagging them in the code. A file entry wins over a folder of another feature.
- Plumbing (config, shared utilities, the base layout) → no feature.
- Mail, notifications, search: the machinery is a feature; each mail or notification belongs to
  the feature that sends it.

In a project with a UI, write the `design-system` feature first (`write-a-feature`), as `inferred`:
direction, components, error messages. Add `grimoire/settings.md` with the app's `languages`; the
Warlock adapter would read `app.localeCodes` anyway, but the file makes the choice visible.

Write the proposal as a table for the owner **before** writing files:

| Feature | Folders      | Flows you see                  | Apps               | Unsure about               |
| ------- | ------------ | ------------------------------ | ------------------ | -------------------------- |
| auth    | src/app/auth | sign-up, login, reset-password | web-client, mobile | is phone login still used? |

Wait for the owner's answer on the list. Features are the frame for everything else; a wrong
frame costs the most to fix.

## 3. Write each feature as inferred

Follow `write-a-feature` for the shapes, with these differences:

```md
---
id: auth
title: Accounts
status: shipped
origin: inferred
version: 1.0
updated: 2026-11-16
apps: [web-client, mobile]
folders: [src/app/auth]
---
```

- `origin: inferred` on the README and on each flow. The owner changes it to `confirmed`.
- **Summaries and stories in plain words.** Write the paragraph under each flow's title (what a user
  does and gets, in one or two sentences) and, where the route and page names make the path clear,
  a `## Story` of numbered sentences in the user's words. Add `audience` and a short `## Why` to
  the README when the code shows who uses the feature and for what. Mark all of it inferred and
  leave a screenshot out unless you can capture it; the owner confirms the wording.
- Start every feature at `1.0`. Do not reconstruct history; the changelog gets one line under `## Unreleased`
  in the feature's own `CHANGELOG.md` (`grimoire/features/auth/CHANGELOG.md`), never in the README:

  ```md
  ## Unreleased

  - 1.0 added described from the existing code
  ```

- **Steps:** take them from the routes and pages, in the order a user meets them. A mail is a
  `*.mail.ts` or `*.email.ts` file (or a file in `mails/` or `emails/`), a job is a queue job or a
  scheduled task. When two sites or apps have a page with one path, write the app after it:
  `page   /support [web-admin]`.
- **Flows:** a flow starts from a route, a page, a job or an event. Logic with no entry point of
  its own (a guard, a calculation) is not a flow: write it in the cases or criteria of the flow
  that reaches it.
- **Cases:** answer the eight questions from what the code does. When the code answers a
  question by doing nothing, that is still what happens: write it as a case with the result
  (`duplicate   saved twice`, `double submit   two accounts`). List a question under
  `## Not handled` only when the behaviour is a gap the owner should decide, in the same form as a
  case (the question, then what happens today):

  ```md
  ## Not handled

  - double submit two quick taps create two accounts
  ```

- **Read-only flows:** a flow that only reads answers the questions that cannot happen with one
  line each, `does not apply: read-only`. That is expected, not a finding.
- **Criteria:** one per case. Tag the existing tests with `@proves` where a test clearly proves
  one. Do not write new tests during a backfill.
- **Intent you cannot see:** write `Unknown: why does a VIP skip the stock check?` in the flow.
  Never invent a reason.

## 4. Describe the apps

One folder per site and mobile app (`describe-an-app`). Declare the conditions you find in the
code (roles, permissions, membership checks). Write page files only for pages that combine
several features or change with the user. When the mobile app defines navigation in code, declare
its screens yourself; they are listed from file names only with file-based routing.

## 5. Check and hand over

```bash
npx warlock grimoire check
```

Fix what it reports about your own files. A backfilled project reports many warnings (criteria with
no test, files with no header); fix errors first and list the warnings for the owner. Then give the owner one list:

- features and flows written, all inferred;
- every `Unknown:` and `Not handled` line, as questions;
- files that belong to no feature;
- files inside a feature that no flow reaches (undescribed behaviour or dead code);
- criteria with no test.

Open one task per question that needs a decision, with `status: waiting for approval` and a
`Decision needed:` line (see `write-a-feature`; any other word is `GR1004`). Mark every task you open
for the owner this way, also when the owner is away. Do not fix code during a backfill; open a task
for each bug you notice.

## Size

Work one feature at a time and finish it before starting the next. A large project takes several
sessions; the task list says where you stopped.
