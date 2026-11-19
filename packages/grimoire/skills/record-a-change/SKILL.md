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

Fix every line it prints. Do not finish with problems you caused. Findings on a flow or feature
with `status: proposed` print with `(expected)` and do not fail the check: leave them until the
code exists.

## 6. At release time

Warlock does not edit your files at release. You do three things, in this order:

1. **Stamp the changelogs.** In each feature that changed, move the `## Unreleased` entries under a
   heading with the release number and date:

   ```md
   ## Unreleased

   ## 1.4.1 (2026-11-20)

   - 2.1 fixed new-arrivals: a customer with no country saw an empty list
     instead of the global one (AC-2)
   ```

2. **Write the release brief.** Create `grimoire/releases/1.4.1.md`:

   ```md
   ---
   release: 1.4.1
   date: 2026-11-20
   ---

   # Release 1.4.1

   Customers with no country on their account see new arrivals again.
   ```

   Two or three sentences on what the release means to users.

3. **Collect the list.**

   ```bash
   npx warlock grimoire release 1.4.1
   ```

   It writes the entries you stamped with that release between the markers under your brief, and
   changes nothing else. It also says how many entries are still unreleased. Do not write that list
   yourself, and run the command again after any change to a changelog: the result is the same
   every time.

`npx warlock grimoire check` reports a listed entry that has no changelog entry stamped with that
release and date, and a release section with no release file.

## Report to the owner

Say what changed in plain words, the feature version, which criteria are proven, what the check
reported, and what is left open with its task id.
