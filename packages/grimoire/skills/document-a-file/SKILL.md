---
name: document-a-file
description: 'Write the one-sentence header and the public-export comments the Grimoire copies into its book, and tag a file with `@feature` when it lives outside its feature''s folders. Use whenever you create a source file or change what one is for.'
---

# Document a file

The Grimoire is experimental: its file structure and commands may still change.

Warlock copies two things from each source file into the book: the sentence at the top, and the
comment above each public export. They are the only words in the book that you write, and they
are what another agent reads to decide whether to open the file.

## The header: one sentence, first thing in the file

Say why the file exists, from the product's side.

```ts
/** Lists the newest products sold in the customer's country. */

export const NEW_ARRIVALS_LIMIT = 20;
```

- One sentence. If you need two, the file probably does two things.
- Say what it is for, not what kind of file it is. The book already knows it is a service.
- Change it when the file's purpose changes. A stale header misleads every reader after you.

| Write | Not |
| --- | --- |
| `Creates a post for the signed-in author.` | `Controller for posts.` |
| `Sends the order confirmation email.` | `This file contains the mail class.` |
| `Decides the price a VIP customer pays.` | `Helper functions.` |

## Public exports: one line each

```ts
/** Returns up to 20 products, newest first. */
export async function listNewArrivals(country?: string) {
  // …
}
```

- Comment only what other files import. Private helpers need no comment.
- Say what the caller gets or what happens. Do not repeat the name ("Lists new arrivals").
- Put limits and units in the line when they exist ("up to 20", "in minutes").

## The feature tag: only for exceptions

A file belongs to the feature whose `folders` contain it. Add a tag only when the file lives
somewhere else:

```ts
/**
 * Deletes accounts that were never verified, seven days after sign-up.
 * @feature auth
 */
```

One feature per file. A file used by several features still has one owner; the book lists the
others as borrowing it. Do not tag shared plumbing (config, generic utilities, the base layout).

## Check your work

```bash
npx warlock scry src/app/catalog/services/new-arrivals.service.ts
```

The `about` line and each export's line should read well on their own, without the code beside
them. `npx warlock grimoire check` reports a file with no header and a file with no feature.

## Do not

- Do not write a comment on every function, field or parameter.
- Do not describe the implementation ("uses a loop to…").
- Do not copy the flow's text into the file. The flow lives in `grimoire/features/`.
