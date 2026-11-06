---
title: "warlock release-notes"
description: Read what changed in a Warlock release from the summaries shipped inside @warlock.js/core and the newer releases published online, with a combined list of breaking changes for a range of versions and JSON for scripts and agents.
sidebar:
  order: 16
  label: "warlock release-notes"
---

`warlock release-notes` prints the release summaries that ship inside the installed
`@warlock.js/core` package. Each summary lists the breaking changes, the new features and the
upgrade notes of one release. It needs no booted app, so it works before an upgrade, in CI and for
an AI agent.

By default it also checks `https://warlock.js.org/release-notes.json` for releases **newer than the
installed one**, so an app on an older version can see what later releases changed or fixed. Pass
`--offline` to skip that check and read only the bundled summaries.

```bash
warlock release-notes                     # the summary of the installed version
warlock release-notes --from 5.36         # every release after 5.36, oldest first
warlock release-notes --from 5.36 --to 5.37.1
warlock release-notes --version 5.35.0    # one release
warlock release-notes --list              # the versions that have a summary, with dates
warlock release-notes --from 5.36 --json  # data for a script or an agent
warlock release-notes --offline           # bundled summaries only, no network
```

| Flag         | Description                                                                                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from`     | Print every release after this version (the version itself is not included), oldest first. Accepts `5.36` or `5.36.0`.                                                                                                                                                                                     |
| `--to`       | With `--from`: the last release to include. Default: the latest release, or the installed one with `--offline` or when the online check fails.                                                                                                                                                             |
| `--offline`  | Skip the online check. Only the summaries shipped in the installed package are read.                                                                                                                                                                                                                       |
| `--version`  | Print the summary of this one version.                                                                                                                                                                                                                                                                     |
| `--list`     | List the versions that have a summary, with their release dates.                                                                                                                                                                                                                                           |
| `--json, -j` | Print `{ installedVersion, latestVersion, versions: [{ version, date, breaking, markdown, installed, source }] }`. `breaking` has one line per breaking change; `markdown` is the full summary; `installed` is `true` when the installed core includes the release; `source` is `"bundled"` or `"remote"`. |

With `--from`, the output starts with a combined **Breaking changes** list taken from each
summary's breaking-changes section, one line per change and prefixed by its release. The summaries
follow in full, oldest first. A release with no breaking changes adds nothing to the list.

## The online check

- With no flags, the installed version's summary is printed as before, followed by a separate
  **Newer releases (not installed)** section: their breaking changes first, then each summary, then
  the upgrade command `npx warlock update`.
- `--from <v>` runs up to the latest release; releases after the installed one are marked as not
  installed (`installed: false` in `--json`). `--version <v>` can show a newer release and `--list`
  marks the installed and the newer versions.
- Versions the installed package ships always come from the package, so they match your installed
  code. Only newer versions are read from the site.
- The check is fail-soft. On a network error, a timeout (5 seconds), a bad response or a response
  over 2 MB, the bundled result is printed with one line saying why the check failed, and the exit
  code is unchanged. With `--json` the reason is in an `onlineError` field instead.
- It contacts only `https://warlock.js.org`, over HTTPS, and treats the response as text to print.

The site builds `release-notes.json` from the same `releases/<version>-summary.md` files the package
bundles.

A summary no source has (for example a version that does not exist) is
reported with the release page to read instead,
`https://github.com/warlockjs/framework/releases/tag/v<version>`, and the command exits 1.

Summaries start at 5.30.0. `warlock upgrade`, `warlock upgrade --check` and `warlock update` end
with a `What's new: npx warlock release-notes --from <old>` line, and the `AGENTS.md` that
`warlock agents-md` generates names the command too.

See [`warlock upgrade`](./upgrade.md) for the code changes an upgrade needs.
