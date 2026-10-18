# Report a Warlock.js framework issue

Use this topic when behavior contradicts the installed version's docs or skills,
a crash originates inside `@warlock.js/*`, or a needed framework capability is
missing. Framework reports belong at <https://github.com/warlockjs/framework>.

## Confirm and search first

1. Reduce the problem to a minimal reproduction in a clean, generic app. Isolate
   application logic, third-party packages and configuration mistakes; a stack
   frame in the framework alone does not prove a framework bug.
2. Read the **installed version's** package `CHANGELOG.md` and skills. Confirm
   that the documented API exists in that version and check whether a later
   release already addresses it. For a feature, describe the missing capability
   and why the documented APIs or an app-level workaround are insufficient.
3. Run `warlock doctor --json` (see `warlock-doctor.md`). Fix app/environment
   findings first. If boot fails, retain only the sanitized failure; `warlock
   issue` itself does not boot the app.
4. Search existing reports, including closed issues, using distinctive public
   terms. If a matching issue exists, show its link and help draft a useful
   follow-up instead of opening a duplicate. Ask before posting that follow-up.

```bash
gh issue list -R warlockjs/framework --state all --search "public error or capability"
```

Without GitHub CLI, use
<https://github.com/warlockjs/framework/issues?q=is%3Aissue> and enter those terms.

## Collect and protect

```bash
warlock issue --type bug --title "Public description of the failure"
warlock issue --type feature --title "Public description of the capability" --json
```

Collect affected package names and **installed versions**, Node and package
manager versions, OS/architecture, TypeScript version, the reviewed `warlock
issue` environment output, a minimal reproduction with exact steps, expected
versus actual behavior, and relevant sanitized logs / `warlock doctor --json`
output. If a tool cannot run or there are no relevant logs, explain why.

**Never paste secrets, tokens, `.env` contents, customer data, proprietary code or
private app names** into titles, bodies, logs, screenshots, repro repositories,
search queries or URLs. Replace the original app with a minimal generic repro.
Review even generated environment output and stack traces; remove local paths,
hostnames and identifying details. The command reads installed package metadata
and a static config summary; it never reads `.env` or executes the app/config.
Do not attach the app's full config or diagnostic report without sanitizing it.

## Draft and get consent

Choose one template below, replace every prompt with concrete evidence, and
write the sanitized body to a local UTF-8 file such as `framework-issue.md`.
**Always show the complete drafted title and body to the user and explicitly ask
before filing.** Generating a draft or URL is not consent to publish. If the user
requests edits, show the revised draft and obtain approval for that version.

### Bug body

```markdown
### Summary

Public description of the framework failure and affected packages.

### Environment / warlock issue output

Reviewed environment output: installed @warlock.js package versions, Node,
package manager + version, OS/arch, TypeScript, static config summary.

### Minimal reproduction

Public minimal code or repro link, setup commands and exact steps.

### Expected behavior

What should happen, with the installed version's docs/skills reference.

### Actual / current behavior

What happens instead, including the error and impact.

### Sanitized logs / doctor output

Relevant logs and warlock doctor --json, or why unavailable / not applicable.

### Checks

- [ ] Searched existing issues and checked installed-version CHANGELOG and skills.
- [ ] Removed secrets, tokens, .env, customer data, proprietary code and private app names.
- [ ] User reviewed this complete draft and approved filing.
```

### Feature request body

```markdown
### Problem / use case

Public description of the missing framework capability and affected packages.

### Environment / warlock issue output

Reviewed environment output: installed @warlock.js package versions, Node,
package manager + version, OS/arch, TypeScript, static config summary.

### Minimal reproduction

Minimal public example of the capability that cannot currently be expressed.

### Proposed behavior

Desired API/behavior, with an example and why it belongs in the framework.

### Actual / current behavior

Current limitation and relevant installed-version docs/skills.

### Alternatives considered

Existing APIs, app-level workarounds and their limitations.

### Sanitized logs / doctor output

Relevant logs and warlock doctor --json, or why unavailable / not applicable.

### Checks

- [ ] Searched existing issues and checked installed-version CHANGELOG and skills.
- [ ] Removed secrets, tokens, .env, customer data, proprietary code and private app names.
- [ ] User reviewed this complete draft and approved filing.
```

Only check a box after completing that step, including obtaining consent.

## File the approved draft

Check `gh --version` and `gh auth status --hostname github.com`. If GitHub CLI is
available and authenticated, **after approval** run:

```bash
gh issue create -R warlockjs/framework --title "Approved public title" --body-file framework-issue.md
```

Return the created issue's link. If GitHub CLI is unavailable or unauthenticated,
give the user the pre-filled new-issue URL printed by `warlock issue` together
with the approved body. The URL selects `bug.yml` or `feature.yml` and prefills
the environment field; the user must complete the remaining form fields. URLs
are capped at 7,500 characters and may include a truncation note: restore the
remaining reviewed output manually. Never claim the issue was filed from merely
printing or opening a URL. `warlock issue` never sends anything itself.

GitHub CLI flags: [list](https://cli.github.com/manual/gh_issue_list),
[create](https://cli.github.com/manual/gh_issue_create),
[authentication](https://cli.github.com/manual/gh_auth_status).
