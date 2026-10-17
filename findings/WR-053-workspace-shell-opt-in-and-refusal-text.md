# WR-053: `ai-workspace` shell: an opt-in full-shell mode, and a refusal that tells the model why

- **Package:** `@warlock.js/ai-workspace` 5.30.0 (`WorkspaceShellPolicy`, `isCommandAllowed`, `run_shell`)
- **Classification:** feature request
- **Found:** 2026-10-17, in Bureau's live acceptance with a real Anthropic key (Haiku).

## What happens

`run_shell` tokenizes the command and spawns the argv directly, with no shell. A command containing unquoted
`&&`, `;`, `|`, redirects, `$` or backticks is refused with "Command is not permitted by the workspace shell
policy". That is a sound default, but it causes two problems for coding agents:

1. **Wasted turns.** Models routinely write `git add -A && git commit -m "…"` or `cd pkg && npm test`. Each refusal
   costs a full model round trip, and the message reads like a permission denial, so the model often gives up on
   the shell and switches tools instead of splitting the command. Bureau now adds a system-prompt line about it, at
   a token cost on every call.
2. **No owner opt-in.** Bureau lets the owner run members in a "bypass" security level, where the owner has
   explicitly accepted that the agent acts like a terminal user. There is no supported way to give such a run
   ordinary shell semantics (pipes, `&&`, redirects) while keeping the jail, timeout, output cap and env isolation.

## Request

- `WorkspaceShellPolicy.interpreter?: "none" | "sh"` (default `"none"`, today's behaviour). With `"sh"`, the
  command runs through `/bin/sh -c` (`cmd.exe /d /s /c` on Windows). `deny` is still checked against every simple
  command in the line. `cwd`, `timeoutMs`, `maxOutputBytes`, `env` and `inheritEnv` apply unchanged.
- A refusal that names the cause, for example: "`&&` is not supported: run_shell executes one command without a
  shell. Run `git add -A`, then `git commit -m …`, as separate calls." Expose a structured `reason`
  (`metacharacter` | `denied-executable` | `not-allowed` | `unbalanced-quotes`) on `WorkspacePolicyError`, so hosts
  can phrase it themselves.
