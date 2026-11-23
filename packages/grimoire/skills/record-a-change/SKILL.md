---
name: record-a-change
description: "Finish a change the Grimoire way: tie each test to the acceptance criterion it proves, reshape the feature README, add the changelog entry with the right version, move the task to done, run `warlock grimoire check`, and write the release brief. Use after building any change, including a bug fix."
---

# Record a change

The Grimoire is experimental: its file structure and commands may still change.

A change is finished when the code, the tests and the description agree. Do these in order.

## 1. Tie tests to criteria

Put a line above each test that proves a criterion:

```ts
// @proves catalog/new-arrivals AC-2
it("returns the global list when the customer has no country", async () => {
  // …
});
```

A criterion about what a user sees is shown instead, by a browser scene in `e2e/*.e2e.ts`. Put the
comment directly above a `shows()` call that repeats the same criterion:

```ts
import { shows } from "@warlock.js/grimoire/warlock";

// @shows contact/send-message AC-3
await shows(context, "contact/send-message AC-3", async ({ page, language, path }) => {
  await page.mockRequests([{ url: "/api/contact", fail: "unreachable" }]);
  await page.goto(path("/"));
});
```

`shows()` runs the scene once per language and saves a screenshot each (`GRIMOIRE_SHOTS=all`
captures every flow, not only the touched ones). A scene that throws fails that language. The owner
approves the images with `warlock grimoire approve`; list every `GR4017` (image changed), `GR4018`
(flow, criterion, case or proof changed) and `GR4019` (rejected change still there) of the check in
your report, and never edit `grimoire/approved/` yourself. From code, `scanShows` reads the `@shows`
lines of the test files and `resolveSettings` fills the defaults of `grimoire/settings.md`.

- End-to-end tests prove a flow's steps. Unit tests prove a business rule ("a reset code expires
  after 10 minutes").
- One test may prove one criterion. If it needs two tags, split the test.
- A bug fix gets a test that fails without the fix. If no criterion covers the bug, the flow was
  missing a case: add the case and the criterion first.

## 2. Reshape the README and the flow

Edit them so they describe the feature **as it is now**, as if it had always been this way. Do
not append "Update:" notes; history goes in the changelog. Set `updated` to today and `version`
to the new version. Set a flow's `status` to `shipped` once its code and tests exist.

## 3. Add the changelog entry

`grimoire/features/catalog/CHANGELOG.md`, newest first, under `## Unreleased`. Warlock never edits
this file; you write every line of it, including the release number and date when the release ships
(step 6):

```md
## Unreleased

- 2.1 fixed new-arrivals: a customer with no country saw an empty list
  instead of the global one (AC-2)
```

| The change                            | Version                   | Word      |
| ------------------------------------- | ------------------------- | --------- |
| A new flow or a new capability        | next whole number (`3.0`) | `added`   |
| Behaviour of an existing flow changes | next decimal (`2.1`)      | `changed` |
| The code did not match the flow       | next decimal (`2.1`)      | `fixed`   |
| A flow is retired                     | next whole number         | `removed` |

One line per change, written for someone who uses the product. Name the flow, and the criterion
when there is one. While the change is unreleased, write no date and no release number.

## 4. Close the task

Move the file from `grimoire/tasks/open/` to `grimoire/tasks/done/<yyyy-mm>/` and set:

```md
status: done
shipped: catalog 2.1
```

Add two lines: how it was verified (which tests, which criteria) and anything left open. If
something is left open, open a new task for it; do not leave it only in the done file. A task
that needs the owner's answer gets `status: waiting for approval` and a `Decision needed:` line.

Name the task id (`T-12`) in every commit message of the change; `warlock grimoire guard --commits <range>` fails a commit that names none.

## 5. Check

```bash
npx warlock grimoire check
```

| It reports                                                          | Do                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| A step names a route, page, mail or job that does not exist         | Fix the name in the flow, or the code                 |
| A criterion has no test                                             | Write the test, or say in the task why not            |
| A test points at a criterion that does not exist                    | Fix the `@proves` line                                |
| Proofs exist but no test results were found (`GR4009`)              | Record results, see below                             |
| A proving test the reporter could not match (`GR4010`)              | Fix the `@proves` line or the test name               |
| A file has no header, or no feature                                 | `document-a-file`                                     |
| A file in the feature's folders that no flow reaches                | Describe the behaviour in a flow, or delete dead code |
| A README `updated` older than its newest changelog entry            | Reshape the README                                    |
| A changelog version that does not fit the word (`added` with `2.1`) | Fix the version                                       |

Migrations, seeds, commands, the main file, layouts, roots and test helpers only specs import are never reported (`GR3006`); a route step reaches the middleware its route names. Do not try to describe those in a flow.

**Recording results.** The check and the devtools tab read test results from
`grimoire/book/test-results.json`, written by the Grimoire Vitest reporter when the tests run. That
folder is not committed, so run the tests with the reporter in CI and ship the results file with the
deploy. To write it elsewhere, pass `grimoireReporter({ file })` and point the devtools panel at it
with the `testResultsFile` option.

Then check the change against its task, before you stop:

```bash
npx warlock grimoire guard T-12
```

It lists files outside the task, deleted proving tests, removed criteria or cases, edited locked tests, protected areas the task does not name, and the code rules on the lines you added. Fix the code rather than widening the task; add a `Files:`, `Touches:` or `Removes:` line only when the owner agreed (`guard-a-change`).

Fix every line it prints. Do not finish with problems you caused. Findings on a flow or feature
with `status: proposed` print with `(expected)` and do not fail the check: leave them until the
code exists.

## 6. At release time

Run the stamp from the app's release flow, after the version is set in `package.json`:

```bash
npx warlock grimoire release --stamp
```

It does three things, in this order, and prints what it did (`stamped catalog, orders → 1.4.1 (2026-11-20)`):

1. **Stamps the changelogs.** In each feature that has entries under `## Unreleased`, it moves them under a
   heading with the release number and date, and leaves an empty `## Unreleased` above:

   ```md
   ## Unreleased

   ## 1.4.1 (2026-11-20)

   - 2.1 fixed new-arrivals: a customer with no country saw an empty list
     instead of the global one (AC-2)
   ```

2. **Writes the release file** `grimoire/releases/1.4.1.md` when it is missing, with its front matter, a
   `# Release 1.4.1` heading and a one-line brief that names the changed features. An existing release file is kept.
   **Rewrite the brief in the owner's words**: two or three sentences on what the release means to users.

   ```md
   ---
   release: 1.4.1
   date: 2026-11-20
   ---

   # Release 1.4.1

   Customers with no country on their account see new arrivals again.
   ```

3. **Collects the list** between the markers under your brief. Run `npx warlock grimoire release 1.4.1` again after
   any change to a changelog or the brief: the result is the same every time. It also says how many entries are
   still unreleased. Do not write that list yourself.

The version is the app's `package.json` version unless you pass one (`release 1.4.1 --stamp`); the date is today unless
the release file has one or you pass `--date yyyy-mm-dd`. The stamp is the only edit Warlock makes to your files, and
only with `--stamp`. Without it you move the entries and write the release file by hand, as above, and run
`npx warlock grimoire release 1.4.1`.

`npx warlock grimoire check` reports a listed entry that has no changelog entry stamped with that
release and date, and a release section with no release file.

## Report to the owner

Say what changed in plain words, the feature version, which criteria are proven, what the check
reported, and what is left open with its task id. Paste the result of `npx warlock grimoire guard`,
and list every change that is not approved (`warlock grimoire check` `GR4017`, `GR4018`, `GR4019`) by
its id; leave none out.
