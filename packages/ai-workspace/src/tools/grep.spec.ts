import { describe, expect, it } from "vitest";
import { createMockBackend } from "../backends/mock";
import { WorkspacePolicyError } from "../errors";
import type { GrepResult, WorkspaceBackend, WorkspaceOps } from "../contracts";
import { makeGrepTool } from "./grep";

/** Absolute jail root the seeded tree lives under. */
const ROOT = "/srv/app";

/** Convert a glob (`*`, `**`, `?`) to an anchored regex over a `/`-path. */
function globToRegExp(glob: string): RegExp {
  let source = "";

  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];

    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index++;

        if (glob[index + 1] === "/") {
          index++;
        }
      } else {
        source += "[^/]*";
      }

      continue;
    }

    if (char === "?") {
      source += "[^/]";

      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${source}$`);
}

/**
 * Recursively collect every file under `dir` as absolute paths. A child
 * is a file iff `readFile` succeeds (the mock cannot distinguish a file
 * from an empty directory via `list`, which returns `[]` for both).
 */
async function walk(backend: WorkspaceBackend, dir: string): Promise<string[]> {
  const found: string[] = [];

  for (const child of await backend.list(dir)) {
    let isFile = false;

    try {
      await backend.readFile(child);
      isFile = true;
    } catch {
      isFile = false;
    }

    if (isFile) {
      found.push(child);
    } else {
      found.push(...(await walk(backend, child)));
    }
  }

  return found;
}

/**
 * A minimal {@link WorkspaceOps} backed by a seeded {@link createMockBackend}
 * tree, implementing real `grep` semantics over the seeded files. Only the
 * methods the grep tool delegates to are populated; the rest throw so an
 * accidental call is loud. `escape` forces every op to reject with a
 * {@link WorkspacePolicyError} for the jail-violation surface test.
 */
function seededOps(files: Record<string, string>, opts: { escape?: boolean } = {}): WorkspaceOps {
  const backend = createMockBackend(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [`${ROOT}/${path}`, content]),
    ),
  );

  const unsupported = (name: string) => async (): Promise<never> => {
    throw new Error(`seededOps.${name} not implemented`);
  };

  return {
    async grep(pattern, grepOpts): Promise<GrepResult> {
      if (opts.escape) {
        throw new WorkspacePolicyError("jail escape", {
          type: "path-escape",
          path: ".",
        });
      }

      const flags = grepOpts?.ignoreCase ? "i" : "";
      const regex = new RegExp(pattern, flags);
      const globRegex = grepOpts?.glob ? globToRegExp(grepOpts.glob) : undefined;
      const matches: GrepResult["matches"] = [];

      for (const absFile of (await walk(backend, ROOT)).sort()) {
        const relativePath = absFile.slice(`${ROOT}/`.length);

        if (globRegex && !globRegex.test(relativePath)) {
          continue;
        }

        const content = await backend.readFile(absFile);
        const lines = content.split("\n");

        for (let index = 0; index < lines.length; index++) {
          if (regex.test(lines[index])) {
            matches.push({ path: relativePath, line: index + 1, text: lines[index] });
          }
        }
      }

      return { matches, total: matches.length };
    },

    readFile: unsupported("readFile"),
    writeFile: unsupported("writeFile"),
    editFile: unsupported("editFile"),
    exec: unsupported("exec"),
    glob: unsupported("glob"),
    exists: unsupported("exists"),
    mkdir: unsupported("mkdir"),
    remove: unsupported("remove"),
    multiEdit: unsupported("multiEdit"),
    applyPatch: unsupported("applyPatch"),
    startShell: unsupported("startShell"),
    shellOutput: unsupported("shellOutput"),
    shellKill: unsupported("shellKill"),
    listShells: () => [],
    listDir: unsupported("listDir"),
    dispose: unsupported("dispose"),
  };
}

const TREE: Record<string, string> = {
  "src/index.ts": "import { foo } from './foo';\nexport const x = foo();\n",
  "src/util/helper.ts": "// TODO: refactor\nexport function help() {\n  return FOO;\n}\n",
  "README.md": "# foo project\nSee src for details.\n",
};

describe("makeGrepTool", () => {
  it("delegates to ops.grep and returns every matching line", async () => {
    const grep = makeGrepTool(seededOps(TREE));

    const { data, error } = await grep.invoke({ pattern: "foo" });

    expect(error).toBeUndefined();
    expect(data?.total).toBe(3);
    expect(data?.matches.map((m) => m.path).sort()).toEqual([
      "README.md",
      "src/index.ts",
      "src/index.ts",
    ]);
    expect(data?.matches.every((m) => m.line >= 1)).toBe(true);
  });

  it("narrows the scan with a glob", async () => {
    const grep = makeGrepTool(seededOps(TREE));

    const { data } = await grep.invoke({ pattern: "foo", glob: "src/*.ts" });

    expect(data?.total).toBe(2);
    expect(data?.matches.every((m) => m.path === "src/index.ts")).toBe(true);
  });

  it("honors case-insensitive matching", async () => {
    const grep = makeGrepTool(seededOps(TREE));

    const sensitive = await grep.invoke({ pattern: "FOO" });
    const insensitive = await grep.invoke({ pattern: "foo", ignoreCase: true });

    // "FOO" appears once (helper.ts); case-insensitive "foo" finds more.
    expect(sensitive.data?.total).toBe(1);
    expect((insensitive.data?.total ?? 0) > (sensitive.data?.total ?? 0)).toBe(true);
  });

  it("defaults to the tool name `grep`", () => {
    expect(makeGrepTool(seededOps(TREE)).name).toBe("grep");
  });

  it("applies a custom tool name override", () => {
    const grep = makeGrepTool(seededOps(TREE), { name: "search_code" });

    expect(grep.name).toBe("search_code");
  });

  it("resolves the present-progressive action from the pattern", () => {
    const grep = makeGrepTool(seededOps(TREE));
    const action = grep.action;

    expect(typeof action).toBe("function");
    expect(typeof action === "function" ? action({ pattern: "TODO" }) : action).toBe(
      "Searching for /TODO/",
    );
  });

  it("rejects a non-string pattern as a validation error, not a throw", async () => {
    const grep = makeGrepTool(seededOps(TREE));

    const { data, error } = await grep.invoke({ pattern: 123 });

    expect(data).toBeUndefined();
    expect(error?.name).toBe("SchemaValidationError");
  });

  it("rejects a missing pattern", async () => {
    const grep = makeGrepTool(seededOps(TREE));

    const { error } = await grep.invoke({});

    expect(error?.name).toBe("SchemaValidationError");
  });

  it("surfaces a policy violation as typed tool-error data", async () => {
    const grep = makeGrepTool(seededOps(TREE, { escape: true }));

    const { data, error } = await grep.invoke({ pattern: "foo" });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(error?.message).toContain("jail escape");
  });
});
