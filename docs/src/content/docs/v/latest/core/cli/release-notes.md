---
title: "warlock release-notes"
description: Read what changed in a Warlock release from the summaries shipped inside @warlock.js/core, offline, with a combined list of breaking changes for a range of versions and JSON for scripts and agents.
sidebar:
  order: 16
  label: "warlock release-notes"
---

`warlock release-notes` prints the release summaries that ship inside the installed
`@warlock.js/core` package. Each summary lists the breaking changes, the new features and the
upgrade notes of one release. The command reads files only: it needs no network and no booted
app, so it works before an upgrade, in CI and for an AI agent.

```bash
warlock release-notes                     # the summary of the installed version
warlock release-notes --from 5.36         # every release after 5.36, oldest first
warlock release-notes --from 5.36 --to 5.37.1
warlock release-notes --version 5.35.0    # one release
warlock release-notes --list              # the versions that have a summary, with dates
warlock release-notes --from 5.36 --json  # data for a script or an agent
```

| Flag         | Description                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from`     | Print every release after this version (the version itself is not included), oldest first. Accepts `5.36` or `5.36.0`.                      |
| `--to`       | With `--from`: the last release to include. Default: the installed version.                                                                 |
| `--version`  | Print the summary of this one version.                                                                                                      |
| `--list`     | List the versions that have a summary, with their release dates.                                                                            |
| `--json, -j` | Print `{ versions: [{ version, date, breaking, markdown }] }`. `breaking` has one line per breaking change; `markdown` is the full summary. |

With `--from`, the output starts with a combined **Breaking changes** list taken from each
summary's breaking-changes section, one line per change and prefixed by its release. The summaries
follow in full, oldest first. A release with no breaking changes adds nothing to the list.

A summary the package does not ship (for example a version newer than the installed one) is
reported with the release page to read instead,
`https://github.com/warlockjs/framework/releases/tag/v<version>`, and the command exits 1.

Summaries start at 5.30.0. `warlock upgrade`, `warlock upgrade --check` and `warlock update` end
with a `What's new: npx warlock release-notes --from <old>` line, and the `AGENTS.md` that
`warlock agents-md` generates names the command too.

See [`warlock upgrade`](./upgrade.md) for the code changes an upgrade needs.
