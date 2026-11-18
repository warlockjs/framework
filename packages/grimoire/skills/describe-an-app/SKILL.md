---
name: describe-an-app
description: "Describe where users meet the product in `grimoire/apps/`: one folder per site or mobile app, its named conditions (guest, customer, membership, preferences), shared layouts, and the pages or screens whose blocks point to feature flows. Use when adding a page, a screen or a block, or when what a page shows depends on who is looking."
---

# Describe an app

The Grimoire is experimental: its file structure and commands may still change.

Features say what the product does. Apps say where a user sees it. One folder per site or mobile
app:

```
grimoire/apps/
  web-client/
    README.md              the app and its conditions
    layouts/site.md        blocks every page of this layout shares
    pages/home/README.md   purpose, layout, blocks
    pages/home/blocks/new-arrivals.md   only when the block has page-specific detail
  web-admin/
  mobile/
    screens/home/README.md      declared by you when navigation is in code
```

Write a file only when it says something the code or a feature flow does not already say. A page
with one purpose, no variation and no blocks from other features needs no file.

## The app README

```md
---
id: web-client
type: site
root: src/web/$sites/client
---

# The shop website

## Conditions

- guest not signed in
- customer signed in
- vip customer with the vip membership
- pref:personalised the customer left personalised content on
```

`origin` is optional (`inferred` or `confirmed`), on the README and on layouts, pages and screens,
as on features. Mark files you wrote from the code `inferred`.

Every page and block of this app uses these names and no others in **Who sees it**. Add a condition here before
using it. Name roles and permissions exactly as the access configuration does, so a reader can
find them in the code.

A mobile app in the same repository is one more app: `type: mobile`, `root: mobile`.

## Mobile screens

How a screen gets into the book depends on how the app navigates:

| The mobile app                   | Screens come from                                                  | You write                                                                             |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| File-based routing (Expo Router) | The route file names under its `app` folder (`collectMobileFacts`) | A screen file only when it says something the route does not                          |
| Navigation defined in code       | Nowhere: the book cannot read it                                   | One file per screen you describe, in `grimoire/apps/<app>/screens/<screen>/README.md` |

A declared screen has a `route` (or a `screen` name) in its front matter:

```md
---
screen: order-tracking
---

# Order tracking

## Blocks

| Block         | Flow               | Who sees it | Changes with |
| ------------- | ------------------ | ----------- | ------------ |
| Courier stage | orders/track-order | customer    | —            |
```

When the app uses file-based routing, `warlock grimoire check` reports a screen whose route has no
file. When navigation is in code, declare every screen a flow names; the check cannot verify it.

## A page or screen

```md
---
route: /
layout: site
---

# Home

The first page a visitor sees.

![The home page](../../../../screenshots/web/home.png)

## Blocks

| Block             | Flow                    | Who sees it | Changes with           |
| ----------------- | ----------------------- | ----------- | ---------------------- |
| Featured products | catalog/browse-products | everyone    | vip: member prices     |
| New arrivals      | catalog/new-arrivals    | everyone    | the customer's country |
| Recent orders     | orders/place-order      | customer    | —                      |
```

- **One row per part of the page**, not one description per kind of user. Three roles and two
  preferences are a few rows, not six pages.
- **Flow** is `feature/flow`. The rule for what the block shows lives there. Do not restate it.
- **Who sees it** uses the app's condition names, and the check reports a name the README does
  not declare (`GR5002`). **Changes with** is free text: it is not checked, but starting an item
  with a condition name (`vip: member prices`) keeps it readable.
- Do not list blocks that come from the layout.

## A layout

`layouts/site.md` has the same Blocks table for what every page of that layout shares (header,
cart count, notifications bell, footer). Write it once; pages inherit it.

## A block file

Only when the block has something to say about this page in particular:

```md
---
flow: catalog/new-arrivals
---

# New arrivals on the home page

![The new arrivals row](../../../../../screenshots/web/home-new-arrivals.png)

- position second row, under Featured products
- shows a grid of up to 20 products
- phones one row that scrolls sideways
```

## Screenshots

Keep image files in `grimoire/screenshots/` (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`), for example
`grimoire/screenshots/web/home.png`. Write an image line `![alt](path)` anywhere in a page, screen
or block file, with the path relative to the Markdown file or starting with `/grimoire/screenshots/`.
The Product map shows these as "where you see it". An image outside the folder is a warning
(`GR1029`); a missing file is a warning (`GR2014`).

## Where a difference between apps goes

| The difference                                                 | Goes in                             |
| -------------------------------------------------------------- | ----------------------------------- |
| What the user gets (mobile uses the device location)           | The flow, under `## Differs by app` |
| How it looks or where it sits (a row on mobile, a grid on web) | That app's block file               |

## How a page is reached, and what it requires

Do not write these. The book lists how a page is reached (links and redirects it can read) and
what it requires (middleware and permissions). Write an entry point yourself only when the book
cannot see it, such as a link in an email:

```md
## Also reached from

- mail order-confirmation
```

## Check

```bash
npx warlock grimoire check
```

It reports a block that points to a flow that does not exist, a condition that is not declared in
the app README, a page whose route is gone, a screen with no route (file-based apps), and a
feature that lists an app with no folder here. Its codes are `GR5001` to `GR5009`;
`npx warlock explain GR5003` describes one.
