import type { ShellWord } from "./shell-parser";

/**
 * PowerShell spells the same operation many ways (`Remove-Item`, `ri`, `rm`,
 * `del`, `erase`, `rd`, `rmdir`; parameters can be shortened to any
 * unambiguous prefix). Deny rules are written against one spelling, so the
 * policy also checks each command in its canonical POSIX-style form:
 * `Remove-Item -Recurse -Force x` is checked as `rm -rf x`.
 */

type ParamRole = "recurse" | "force" | "operand" | "value" | "switch" | "method" | "outfile";

interface Family {
  /** The canonical executable name. */
  canonical: string;
  /** Every spelling (lowercase) that means this family. */
  names: string[];
  /** Flag characters emitted for `-Recurse` / `-Force` (empty: not emitted). */
  recurseFlag: string;
  forceFlag: string;
  /** Parameters in priority order (the first whose name starts with the typed prefix wins). */
  params: Array<[string, ParamRole]>;
}

const FAMILIES: Family[] = [
  {
    canonical: "rm",
    names: ["remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"],
    recurseFlag: "r",
    forceFlag: "f",
    params: [
      ["recurse", "recurse"],
      ["force", "force"],
      ["path", "operand"],
      ["literalpath", "operand"],
      ["whatif", "switch"],
      ["confirm", "switch"],
      ["filter", "value"],
      ["include", "value"],
      ["exclude", "value"],
      ["credential", "value"],
      ["stream", "value"],
    ],
  },
  {
    canonical: "cp",
    names: ["copy-item", "cpi", "cp", "copy"],
    recurseFlag: "r",
    forceFlag: "f",
    params: [
      ["recurse", "recurse"],
      ["force", "force"],
      ["path", "operand"],
      ["literalpath", "operand"],
      ["destination", "operand"],
      ["whatif", "switch"],
      ["confirm", "switch"],
      ["filter", "value"],
      ["include", "value"],
      ["exclude", "value"],
      ["credential", "value"],
    ],
  },
  {
    canonical: "mv",
    names: ["move-item", "mi", "mv", "move"],
    recurseFlag: "",
    forceFlag: "f",
    params: [
      ["force", "force"],
      ["path", "operand"],
      ["literalpath", "operand"],
      ["destination", "operand"],
      ["whatif", "switch"],
      ["confirm", "switch"],
      ["filter", "value"],
      ["include", "value"],
      ["exclude", "value"],
      ["credential", "value"],
    ],
  },
  {
    canonical: "ls",
    names: ["get-childitem", "gci", "ls", "dir"],
    recurseFlag: "R",
    forceFlag: "a",
    params: [
      ["recurse", "recurse"],
      ["force", "force"],
      ["path", "operand"],
      ["literalpath", "operand"],
      ["filter", "value"],
      ["include", "value"],
      ["exclude", "value"],
      ["depth", "value"],
      ["name", "switch"],
    ],
  },
  {
    canonical: "cat",
    names: ["get-content", "gc", "cat", "type"],
    recurseFlag: "",
    forceFlag: "",
    params: [
      ["path", "operand"],
      ["literalpath", "operand"],
      ["totalcount", "value"],
      ["tail", "value"],
      ["head", "value"],
      ["encoding", "value"],
      ["filter", "value"],
      ["include", "value"],
      ["exclude", "value"],
      ["force", "switch"],
      ["raw", "switch"],
      ["wait", "switch"],
    ],
  },
  {
    canonical: "curl",
    names: ["invoke-webrequest", "iwr", "invoke-restmethod", "irm", "curl", "wget"],
    recurseFlag: "",
    forceFlag: "",
    params: [
      ["uri", "operand"],
      ["outfile", "outfile"],
      ["method", "method"],
      ["headers", "value"],
      ["body", "value"],
      ["contenttype", "value"],
      ["useragent", "value"],
      ["credential", "value"],
      ["timeoutsec", "value"],
      ["proxy", "value"],
    ],
  },
  {
    canonical: "kill",
    names: ["stop-process", "spps", "kill"],
    recurseFlag: "",
    forceFlag: "9",
    params: [
      ["id", "operand"],
      ["name", "operand"],
      ["force", "force"],
      ["inputobject", "value"],
      ["whatif", "switch"],
      ["confirm", "switch"],
    ],
  },
];

const BY_NAME = new Map<string, Family>();

for (const family of FAMILIES) {
  for (const name of family.names) {
    BY_NAME.set(name, family);
  }
}

/** PowerShell reads an en dash, em dash or horizontal bar as the parameter dash too. */
const FLAG_ORDER = "rRfa9";

const DASH = /^[-–—―]/;

/** Lowercase executable name used to look an alias up. */
function aliasKey(first: string): string {
  const base = first.split(/[\\/]/).pop() ?? first;

  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

/** Split `-Name` / `-Name:value` into the lowercase name and the inline value. */
function parameter(arg: string): { name: string; inline?: string } | null {
  if (!DASH.test(arg) || arg.length < 2) {
    return null;
  }

  const body = arg.slice(1);
  const colon = body.indexOf(":");

  return colon === -1
    ? { name: body.toLowerCase() }
    : { name: body.slice(0, colon).toLowerCase(), inline: body.slice(colon + 1) };
}

/**
 * The canonical argv of a PowerShell command that uses an alias or cmdlet
 * name from the table (`Remove-Item -Recurse -Force x` → `["rm", "-rf", "x"]`),
 * or `undefined` when the command has no canonical form.
 */
export function canonicalPowerShellArgv(argv: readonly string[]): string[] | undefined {
  const family = BY_NAME.get(aliasKey(argv[0] ?? ""));

  if (family === undefined) {
    return undefined;
  }

  let flags = "";
  const operands: string[] = [];
  const extras: string[] = [];

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const parsed = parameter(arg);

    if (parsed === null) {
      operands.push(arg);

      continue;
    }

    const match = family.params.find(
      ([name]) => parsed.name !== "" && name.startsWith(parsed.name),
    );

    if (match === undefined) {
      continue;
    }

    const role = match[1];

    if (role === "recurse") {
      flags += family.recurseFlag;
    } else if (role === "force") {
      flags += family.forceFlag;
    } else if (role === "switch") {
      continue;
    } else {
      const value = parsed.inline ?? argv[++index] ?? "";

      if (role === "operand") {
        operands.push(value);
      } else if (role === "outfile") {
        extras.push("-o", value);
      } else if (role === "method") {
        extras.push("-X", value);
      }
    }
  }

  // Keep each flag once, in a stable order.
  const unique = [...FLAG_ORDER].filter((flag) => flags.includes(flag)).join("");

  return [family.canonical, ...(unique !== "" ? [`-${unique}`] : []), ...extras, ...operands];
}

/** The names PowerShell's `cd` goes by. */
export const POWERSHELL_CD_NAMES = new Set(["cd", "sl", "set-location", "chdir"]);

/** Directory stack commands, refused because the policy does not track them. */
export const POWERSHELL_DIRECTORY_STACK = new Set([
  "push-location",
  "pushd",
  "pop-location",
  "popd",
]);

/**
 * Normalise a PowerShell `cd` to `[cd, directory]`: `-Path x`, `-LiteralPath x`
 * (and their prefixes, `-Path:x`) become the directory operand. Returns `null`
 * for any other parameter (`-PassThru`, `-StackName`, …).
 */
export function normalizePowerShellCd(words: ShellWord[]): ShellWord[] | null {
  const first = words[0];

  if (first === undefined) {
    return null;
  }

  const operands: ShellWord[] = [];

  for (let index = 1; index < words.length; index++) {
    const word = words[index] as ShellWord;
    const parsed = word.quoted ? null : parameter(word.value);

    if (parsed === null) {
      operands.push(word);

      continue;
    }

    const isPath = parsed.name.length >= 2 && "path".startsWith(parsed.name);
    const isLiteral = parsed.name.length >= 1 && "literalpath".startsWith(parsed.name);

    if (!isPath && !isLiteral) {
      return null;
    }

    if (parsed.inline !== undefined) {
      operands.push({ ...word, raw: parsed.inline, value: parsed.inline });
    } else {
      const next = words[++index];

      if (next === undefined) {
        return null;
      }

      operands.push(next);
    }
  }

  return [first, ...operands];
}
