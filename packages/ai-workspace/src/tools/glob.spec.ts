import { describe, expect, it } from "vitest";
import { createMockBackend } from "../backends/mock";
import { WorkspacePolicyError } from "../errors";
import type { WorkspaceBackend, WorkspaceOps } from "../contracts";
import { makeGlobTool } from "./glob";

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
 * tree, implementing real `glob` semantics (a sorted `string[]` of
 * matching workspace-relative paths). Only the method the glob tool
 * delegates to is populated; the rest throw so an accidental call is
 * loud. `escape` forces the op to reject with a {@link WorkspacePolicyError}
 * for the jail-violation surface test.
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
    async glob(pattern): Promise<string[]> {
      if (opts.escape) {
        throw new WorkspacePolicyError("jail escape", {
          type: "path-escape",
          path: ".",
        });
      }

      const regex = globToRegExp(pattern);
      const matched: string[] = [];

      for (const absFile of await walk(backend, ROOT)) {
        const relativePath = absFile.slice(`${ROOT}/`.length);

        if (regex.test(relativePath)) {
          matched.push(relativePath);
        }
      }

      return matched.sort();
    },

    readFile: unsupported("readFile"),
    writeFile: unsupported("writeFile"),
    editFile: unsupported("editFile"),
    exec: unsupported("exec"),
    grep: unsupported("grep"),
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
  "src/index.ts": "x",
  "src/util/helper.ts": "y",
  "src/models/user.ts": "z",
  "src/models/post.ts": "z",
  "README.md": "z",
};

describe("makeGlobTool", () => {
  it("delegates to ops.glob and wraps the result in a { paths } envelope", async () => {
    const glob = makeGlobTool(seededOps(TREE));

    const { data, error } = await glob.invoke({ pattern: "src/**/*.ts" });

    expect(error).toBeUndefined();
    expect(data?.paths).toEqual([
      "src/index.ts",
      "src/models/post.ts",
      "src/models/user.ts",
      "src/util/helper.ts",
    ]);
  });

  it("matches a single-segment pattern", async () => {
    const glob = makeGlobTool(seededOps(TREE));

    const { data } = await glob.invoke({ pattern: "src/*.ts" });

    expect(data?.paths).toEqual(["src/index.ts"]);
  });

  it("returns an empty path list (not an error) when nothing matches", async () => {
    const glob = makeGlobTool(seededOps(TREE));

    const { data, error } = await glob.invoke({ pattern: "test/**/*.spec.ts" });

    expect(error).toBeUndefined();
    expect(data?.paths).toEqual([]);
  });

  it("defaults to the tool name `glob`", () => {
    expect(makeGlobTool(seededOps(TREE)).name).toBe("glob");
  });

  it("applies a custom tool name override", () => {
    const glob = makeGlobTool(seededOps(TREE), { name: "find_files" });

    expect(glob.name).toBe("find_files");
  });

  it("resolves the present-progressive action from the pattern", () => {
    const glob = makeGlobTool(seededOps(TREE));
    const action = glob.action;

    expect(typeof action).toBe("function");
    expect(typeof action === "function" ? action({ pattern: "src/*.ts" }) : action).toBe(
      "Finding files matching src/*.ts",
    );
  });

  it("rejects a non-string pattern as a validation error, not a throw", async () => {
    const glob = makeGlobTool(seededOps(TREE));

    const { data, error } = await glob.invoke({ pattern: 123 });

    expect(data).toBeUndefined();
    expect(error?.name).toBe("SchemaValidationError");
  });

  it("rejects a missing pattern", async () => {
    const glob = makeGlobTool(seededOps(TREE));

    const { error } = await glob.invoke({});

    expect(error?.name).toBe("SchemaValidationError");
  });

  it("surfaces a policy violation as typed tool-error data", async () => {
    const glob = makeGlobTool(seededOps(TREE, { escape: true }));

    const { data, error } = await glob.invoke({ pattern: "src/**/*.ts" });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(error?.message).toContain("jail escape");
  });
});
