---
name: write-a-feature
description: "Describe a new feature, or a new version of one, in `grimoire/features/` before writing code: the task, the brief, the README front matter, each flow with its steps, cases and acceptance criteria. Use when the owner asks for something the product does not do yet."
---

# Write a feature

The Grimoire is experimental: its file structure and commands may still change.

Describe the behaviour first, then build it. The description is the brief the owner approves and
the thing your tests will prove.

## Is it a feature, a flow, or a change?

- **A feature** is something a user or another system can do, named from their side (`auth`,
  `catalog`, `orders`). It has roughly two to ten flows.
- **A flow** is one path through it (`sign-up`, `google-login`, `new-arrivals`).
- **A new capability** in an existing feature is a new whole-number version (`2.0`) with its
  own brief. **A small change or a fix** is a decimal (`2.1`) and needs no brief: go to
  `record-a-change`.
- A notification, mail or job belongs to the feature whose business reason creates it. "Your
  order shipped" belongs to `orders`, not to `notifications`.

## 1. Open a task

`grimoire/tasks/open/T-014-wishlist.md`:

```md
---
id: T-014
type: feature
feature: catalog
apps: [web-client, mobile]
status: waiting for approval
---

# Let customers save products to a wishlist

- Asked by: the owner, 2026-11-16
- Why: customers ask to keep products for later
- Brief: features/catalog/versions/v3.md
- Decision needed: one wishlist per customer, or several named lists?
```

A task that waits for the owner's answer has `status: waiting for approval` and a `Decision needed:` line.
The other statuses are `open`, `approved`, `in progress`, `blocked`, `done` and `dropped`; any other
word is an error (`GR1004`).

## 2. Write the brief

`grimoire/features/catalog/versions/v3.md`: why, what changes (which flows are new or changed),
and what is out of scope. Keep it to one screen.

## Write `design-system` first

In a project that has a UI, create the `design-system` feature before any other. Its flows are the
rules every screen follows: `direction` (inputs and text follow the reading direction, a page is
mirrored in Arabic), `components` (every component renders in each language), `error-messages`
(every error says what failed and what to do next), plus spacing and colours (contrast) when the
project has rules for them. Every flow with a `page` step names `design-system` under
`## Affects and affected by` (`- affects design-system`), so a change to a screen is checked against it.
Its criteria are shown with `@shows` scenes (`record-a-change`).

## 3. Write or update the feature README

```md
---
id: catalog
title: Product catalog
status: proposed
version: 3.0
updated: 2026-11-16
apps: [web-client, mobile]
folders: [src/app/catalog, src/web/$sites/client/products]
audience: [shoppers, store staff]
---

# Product catalog

Customers browse products, search them and see what is new.

## Why

Shoppers decide what to buy from the catalog, so it has to be quick to browse and clear about what is new.

## Flows

- browse-products list and filter products
- new-arrivals the newest products sold in the customer's country
- wishlist save a product for later

## Affects and affected by

- affected by orders/place-order (lowers stock)
```

`audience` (optional) lists who the feature is for, in plain words. `## Why` (optional) says why the
feature exists in a few sentences. Without `audience`, readers use the `who` of the flows.

`id` never changes. `folders` are the folders whose files belong to this feature. An entry with a
code-file extension names one file (`src/web/components/client/home/pricing-table.tsx`), for a
feature that owns a few files in a folder shared with others. A file entry wins over the folder
of another feature; each file has one owner. `apps` must
exist under `grimoire/apps/`. A feature whose folders hold no file yet is fine while it is
`proposed`.

## 4. Write each flow

`grimoire/features/catalog/flows/wishlist.md`:

```md
---
id: wishlist
since: 3.0
status: proposed
who: customer
---

# Save a product to the wishlist

A customer saves a product they like and finds it again later on their wishlist.

## Story

1. The customer opens a product and taps "Save for later".
2. The product shows a filled heart.
   ![The saved product](../../../screenshots/web/wishlist-saved.png)
3. Later, the customer opens their wishlist and sees the product there.

## Steps

1. page /products/:id
2. route POST /wishlist
3. notification wishlist-price-drop
4. page /wishlist

## Differs by app

- mobile the save button is also on the product card in lists

## Cases

- invalid input a product id that is not an id → 422
- not allowed guest → sent to sign in, then back to the product
- not found the product does not exist → 404
- duplicate already saved → stays saved, no error (AC-2)
- limits at most 200 products
- expiry does not apply: saved products do not expire
- double submit two taps save once
- outside service down does not apply: no outside service is called
- server unreachable the save button shows "Could not reach the server, check your connection" (AC-5)
- server error the product stays unsaved and the message says what failed (AC-5)

## Acceptance criteria

- AC-1 a saved product appears on /wishlist
- AC-2 saving twice keeps one entry
- AC-3 a guest is sent to sign in and returns to the product
- AC-4 [mobile] the product card has a save button
- AC-5 a failed save says what failed and what to do next
```

**Summary.** The paragraph under the `# Title`: one or two plain sentences saying who does what and
what they get. A flow with none gets a warning (`GR1030`).

**Story.** Optional. Numbered sentences in the user's words, without file names or code, for readers
who do not read code. Indent a second line to continue a sentence. An image line
`![alt](path)` under a step attaches a screenshot to it.

**Screenshots.** Keep image files in `grimoire/screenshots/` (any subfolders; `.png`, `.jpg`,
`.jpeg`, `.webp` or `.gif`). Write the path relative to the Markdown file, so it also shows on a git
host (`../../../screenshots/web/wishlist-saved.png` from a flow file), or start it with
`/grimoire/screenshots/`. An image outside that folder is a warning (`GR1029`), a missing file too
(`GR2014`).

**Product map.** The Grimoire tab has a Product map for readers who are not developers. They see the
flow summary, the feature's why and audience, the story in plain words and the screenshots there,
so write them for a person who has never opened the code.

**Steps.** Each step has a kind and the name used in code: `page`, `route`, `mail`,
`notification`, `job`, `event`, `outside service`. Use `affects` for an effect on another
feature (`affects   catalog/stock`). Warlock checks every name exists. A mail is a `*.mail.ts` or
`*.email.ts` file, or a file in a `mails/` or `emails/` folder; a job is a queue job
(`defineJob()`) or a scheduled task, by its name in code.

When two sites, or a site and the mobile app, have a page with the same path, name the app after
the path in brackets: `page   /support [web-admin]`. The step then looks in that app only (its
pages, or its screens for a mobile app). Without brackets it looks in the apps the feature lists.

**Screenshots of a flow.** Criteria about what a user sees are shown in each language of the app
(`languages` in `grimoire/settings.md`), so one criterion gives one screenshot per language. Write a
criterion once; do not write one per language. A flow with nothing to look at (no screen, or a
screen that cannot be captured) says `screenshots: false` in its front matter. `screenshots` is
`false` or absent; the modes `changed`, `all` and `off` live in the settings
(`SCREENSHOT_MODES`, default `DEFAULT_GRIMOIRE_SETTINGS.screenshots`, `changed`).

**Cases.** End a case line with `(AC-n)` (or `(AC-1, AC-2)`) to link it to the criterion that
proves it; a number the flow does not have is an error (`GR2013`). Answer all eight questions (invalid input, not allowed, not found, duplicate, limits,
expiry, double submit, outside service down), each with a case or "does not apply" and the
reason. A flow with a `page` step also answers the two UI questions (`UI_CASE_QUESTIONS`):
`server unreachable` (what the user sees when the request never arrives) and `server error`
(when the server answers with a failure); the screen of each is shown with a scene that mocks
the request. A flow that skips one gets a finding, except that a flow with no writes (only pages and
`GET` routes) may leave out `duplicate` and `double submit`. Do not invent cases beyond the questions unless the owner described one.

**Criteria.** One per case that changes what the user gets. Number them `AC-1`, `AC-2`, … and
never renumber. Scope one to an app with `[app-id]`.

**App differences.** What the user gets differs → here, under the app's name. How it looks or
where it sits → the app's block file (`describe-an-app`).

## 5. Stop for approval

For a new feature or a whole-number version, stop here. Tell the owner the task id and the brief
path, list the decisions you need, and wait. Do not write code first.

## 6. Check

```bash
npx warlock grimoire check
```

Until the code exists it reports the routes and pages you named as missing. Findings on a flow or
feature with `status: proposed` print with `(expected)` and do not fail the check; everything else
it reports must be fixed.

Then build, and follow `record-a-change`.
