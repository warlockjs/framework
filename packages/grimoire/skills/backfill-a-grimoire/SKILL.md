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
- Plumbing (config, shared utilities, the base layout) → no feature.
- Mail, notifications, search: the machinery is a feature; each mail or notification belongs to
  the feature that sends it.

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
- Start every feature at `1.0`. Do not reconstruct history; the changelog gets one line under `## Unreleased`:
  `- 1.0  added  described from the existing code`.
- **Steps:** take them from the routes and pages, in the order a user meets them.
- **Cases:** write only the cases the code handles. For a question the code does not handle
  (a double submit, an expired code), do not write a case. List it under `## Not handled`, in the
  same form as a case (the question, then what happens today), so the owner sees the gap:

  ```md
  ## Not handled

  - double submit two quick taps create two accounts
  ```

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

Open one task per question that needs a decision. Do not fix code during a backfill; open a task
for each bug you notice.

## Size

Work one feature at a time and finish it before starting the next. A large project takes several
sessions; the task list says where you stopped.
