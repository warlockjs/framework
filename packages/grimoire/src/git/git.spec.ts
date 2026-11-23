import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GrimoireError } from "../codes";
import { changedFiles, commitsIn, filesAt, resolveBase, showFile } from "./index";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/** A repository with one commit holding `a.ts`, `b.ts`, `c.ts` and `d/e.ts`. */
function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-git-"));

  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  git(root, "config", "commit.gpgsign", "false");
  write(root, "a.ts", "one\ntwo\nthree\n");
  write(root, "b.ts", "keep\n");
  write(
    root,
    "c.ts",
    "this file will be renamed with all its content kept the same\nline 2\nline 3\n",
  );
  write(root, "d/e.ts", "x\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first T-1");

  return root;
}

describe("changedFiles", () => {
  it("reports added, modified, deleted, renamed and untracked files with their added lines", async () => {
    const root = repo();
    const base = git(root, "rev-parse", "HEAD");

    write(root, "a.ts", "one\nTWO\nthree\nfour\n");
    unlinkSync(path.join(root, "b.ts"));
    renameSync(path.join(root, "c.ts"), path.join(root, "c-renamed.ts"));
    git(root, "add", "-A");
    write(root, "new.ts", "n1\nn2\n");
    write(root, "d/untracked.css", ".a {}\n");

    const changed = await changedFiles(root, base);

    expect(changed).toEqual([
      { file: "a.ts", status: "modified", from: null, addedLines: [2, 4] },
      { file: "b.ts", status: "deleted", from: null, addedLines: [] },
      { file: "c-renamed.ts", status: "renamed", from: "c.ts", addedLines: [] },
      { file: "d/untracked.css", status: "added", from: null, addedLines: [1] },
      { file: "new.ts", status: "added", from: null, addedLines: [1, 2] },
    ]);
  });

  it("sees committed changes since the base, and nothing when nothing changed", async () => {
    const root = repo();
    const base = git(root, "rev-parse", "HEAD");

    expect(await changedFiles(root, base)).toEqual([]);

    write(root, "b.ts", "keep\nmore\n");
    git(root, "commit", "-q", "-am", "second T-1");

    expect(await changedFiles(root, base)).toEqual([
      { file: "b.ts", status: "modified", from: null, addedLines: [2] },
    ]);
  });

  it("reads an added line that starts with ++ as a line, not as a file header", async () => {
    const root = repo();
    const base = git(root, "rev-parse", "HEAD");

    write(root, "a.ts", "one\n++ counter\nthree\n");
    write(root, "b.ts", "keep\nmore\n");

    expect(await changedFiles(root, base)).toEqual([
      { file: "a.ts", status: "modified", from: null, addedLines: [2] },
      { file: "b.ts", status: "modified", from: null, addedLines: [2] },
    ]);
  });

  it("lists paths relative to a project folder inside a larger repository", async () => {
    const root = repo();
    const base = git(root, "rev-parse", "HEAD");

    write(root, "d/e.ts", "x\ny\n");
    write(root, "a.ts", "changed\n");

    expect(await changedFiles(path.join(root, "d"), base)).toEqual([
      { file: "e.ts", status: "modified", from: null, addedLines: [2] },
    ]);
  });
});

describe("showFile and filesAt", () => {
  it("reads a file at a ref and answers null when it is not there", async () => {
    const root = repo();
    const base = git(root, "rev-parse", "HEAD");

    write(root, "a.ts", "changed\n");

    expect(await showFile(root, base, "a.ts")).toBe("one\ntwo\nthree\n");
    expect(await showFile(root, base, "missing.ts")).toBeNull();
    expect(await showFile(root, "HEAD", "d/e.ts")).toBe("x\n");
  });

  it("throws GR9009 for a ref that does not exist", async () => {
    const root = repo();

    await expect(showFile(root, "nope", "a.ts")).rejects.toMatchObject({ code: "GR9009" });
  });

  it("lists the files under a folder at a ref", async () => {
    const root = repo();

    expect(await filesAt(root, "HEAD", "d")).toEqual(["d/e.ts"]);
    expect(await filesAt(root, "HEAD", "none")).toEqual([]);
  });
});

describe("commitsIn", () => {
  it("lists the commits of a range, oldest first, with subject and body", async () => {
    const root = repo();
    const first = git(root, "rev-parse", "HEAD");

    write(root, "b.ts", "2\n");
    git(root, "commit", "-q", "-am", "second\n\nbody line T-2");
    write(root, "b.ts", "3\n");
    git(root, "commit", "-q", "-am", "third");

    const commits = await commitsIn(root, `${first}..HEAD`);

    expect(commits.map((commit) => commit.subject)).toEqual(["second", "third"]);
    expect(commits[0]?.body).toBe("body line T-2");
    expect(commits[0]?.sha).toHaveLength(40);
    expect(await commitsIn(root, "HEAD..HEAD")).toEqual([]);
  });

  it("throws GR9009 for a range git cannot read", async () => {
    await expect(commitsIn(repo(), "nope..HEAD")).rejects.toBeInstanceOf(GrimoireError);
  });
});

describe("resolveBase", () => {
  it("returns the merge base with the default branch, or HEAD on it", async () => {
    const root = repo();
    const first = git(root, "rev-parse", "HEAD");

    expect(await resolveBase(root)).toBe(first);

    git(root, "checkout", "-q", "-b", "work");
    write(root, "b.ts", "2\n");
    git(root, "commit", "-q", "-am", "work");

    expect(await resolveBase(root)).toBe(first);
    expect(await resolveBase(root, "main")).toBe(first);
  });

  it("uses a base that is behind the branch as the point the branch left it", async () => {
    const root = repo();
    const first = git(root, "rev-parse", "HEAD");

    git(root, "checkout", "-q", "-b", "work");
    write(root, "b.ts", "work\n");
    git(root, "commit", "-q", "-am", "work");
    git(root, "checkout", "-q", "main");
    write(root, "a.ts", "main moved\n");
    git(root, "commit", "-q", "-am", "main moved");
    git(root, "checkout", "-q", "work");

    expect(await resolveBase(root, "main")).toBe(first);
  });

  it("throws GR9009 for an unknown base", async () => {
    await expect(resolveBase(repo(), "origin/nowhere")).rejects.toMatchObject({ code: "GR9009" });
  });

  it("throws GR9009 outside a git repository", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-nogit-"));

    roots.push(root);

    await expect(resolveBase(root)).rejects.toMatchObject({ code: "GR9009" });
  });
});
