---
title: "warlock issue"
description: Prepare a reviewed bug report or feature request with installed environment details, even when the app cannot boot.
sidebar:
  order: 10
  label: "warlock issue"
---

`warlock issue` prints an environment block and a pre-filled link for a bug report
or feature request in [warlockjs/framework](https://github.com/warlockjs/framework).
It prepares the report locally and never submits, opens a browser or contacts
GitHub. It has no preload and works when app imports or configuration would fail
at boot.

```bash
warlock issue
warlock issue --type bug --title "Unexpected response behavior"
warlock issue --type feature --title "Support an additional capability"
warlock issue --json
```

| Flag         | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `--type`     | `bug` (default) or `feature`; other values fail.               |
| `--title`    | Public title, capped at 256 Unicode code points in the URL.    |
| `--json, -j` | Print only `{ schemaVersion: 1, environment, url }` on stdout. |

The environment contains installed `@warlock.js/*` versions read from
`node_modules` (including ancestor directories for hoisted packages), Node,
package manager name and version, OS/platform/release/architecture, installed
TypeScript version, and a static summary of `warlock.config.ts`. Declared package
version ranges are not substituted for installed versions. Missing versions are
`null`; packages that cannot be read are omitted. The package manager comes from
the invoking tool's user agent, or a declared manager/lockfile and a bounded local
`--version` probe outside the app (avoiding project plugins and version switching);
if unavailable, its version is `null` (or the entire manager is
`null` when unidentified).

Config is parsed as syntax, never executed. Only known section names, literal
boolean build flags, connector count and custom command count are included.
Arbitrary keys, string values, connector/command names and paths are excluded.
`status` is `missing`, `unreadable`, `unparsed` or `static`; only inline exported
objects and `defineConfig({ ... })` are recognized. Counts are `null` for dynamic
expressions or spread arrays. `dynamic` flags top-level spreads/computed keys or
unrecognized config; this is a partial source summary, not resolved runtime
configuration. `.env` and app modules are not loaded.

The URL selects `bug.yml` or `feature.yml`, carries an encoded title and Markdown
body, and prefills the YAML form's `environment` field by its field ID. Complete
the remaining required fields in the browser. Its entire encoded length is at
most **7,500 characters**, a conservative budget rather than a guaranteed GitHub
limit. Oversized bodies/environment fields are truncated with a note; paste the
remaining **reviewed** output into the form manually. JSON and terminal
environment output remain complete.

## Reporting issues

Confirm the failure in a minimal generic reproduction; a framework stack frame
alone does not prove a framework bug. Check the installed version's CHANGELOG
and skills, run [`warlock doctor --json`](./doctor.md) when possible, and search
[existing issues, including closed reports](https://github.com/warlockjs/framework/issues?q=is%3Aissue)
first:

```bash
gh issue list -R warlockjs/framework --state all --search "public error or capability"
```

Collect package names/versions, Node and package manager versions, OS, reviewed
`warlock issue` output, minimal code and exact steps, expected versus actual
behavior, and sanitized logs/doctor output. For features, include the use case,
desired behavior and alternatives. Explain any unavailable diagnostics.

Never include secrets, tokens, `.env` contents, customer data, proprietary code
or private app names in a report, title, search query or URL. Review generated
output and strip identifying paths and hostnames from logs.

**Agents must show the complete drafted title and body to the user and ask before
filing.** After explicit approval, if `gh --version` and
`gh auth status --hostname github.com` succeed, submit the reviewed local body:

```bash
gh issue create -R warlockjs/framework --title "Approved public title" --body-file framework-issue.md
```

Otherwise give the user the URL printed by `warlock issue` and the reviewed body
to complete the form themselves. Printing a URL does not file an issue. App
agents can follow the `report-framework-issue` topic in core's skill index for
separate bug/feature body templates and the full consent workflow.

The issue chooser disables blank issues to encourage complete reports and links
to the docs for setup questions. See GitHub's
[form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema),
[issue form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms),
[URL prefills](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query),
[chooser configuration](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository#configuring-the-template-chooser)
and [GitHub CLI create flags](https://cli.github.com/manual/gh_issue_create).
