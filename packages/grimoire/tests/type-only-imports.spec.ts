/**
 * The files behind a page step must not include server files that the page
 * reaches only through a type-only import of a barrel. The page imports a
 * form; the form takes a `User` type from a barrel (`import type`); the
 * barrel re-exports a model, which imports the database connection.
 *
 * The first spec shows what a walk reaches when no edge is marked (every edge
 * is followed). The others check that the scanner marks the type-only edges and
 * that the walk leaves them out.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectFiles } from "@warlock.js/core/tooling";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileGraph, importClosure, type FileGraph } from "../src/graph";

const FILES: Record<string, string> = {
  "src/app/web/pages/sign-in.page.tsx": [
    'import { SignInForm } from "./sign-in-form";',
    "export default function SignInPage() { return SignInForm(); }",
  ].join("\n"),
  "src/app/web/pages/sign-in-form.tsx": [
    'import type { User } from "../../shared";',
    'import { type Session } from "../../shared/session";',
    "export function SignInForm(user?: User, session?: Session) { return [user, session]; }",
  ].join("\n"),
  "src/app/shared/index.ts": [
    'export * from "./user.model";',
    'export type { Session } from "./session";',
  ].join("\n"),
  "src/app/shared/user.model.ts": [
    'import { db } from "../db/connection";',
    "export type User = { id: string };",
    "export class UserModel { public table = db; }",
  ].join("\n"),
  "src/app/shared/session.ts": [
    'import { db } from "../db/connection";',
    "export type Session = { token: string };",
    "export const sessions = db;",
  ].join("\n"),
  "src/app/db/connection.ts": "export const db = {};",
  "src/app/web/pages/about.page.tsx": [
    'export type * from "./about-types";',
    'export type Settings = typeof import("./about-settings");',
    "export default function AboutPage() { return null; }",
  ].join("\n"),
  "src/app/web/pages/about-types.ts":
    'import { db } from "../../db/connection"; export type Page = typeof db;',
  "src/app/web/pages/about-settings.ts": "export const settings = {};",
};

const PAGE = "src/app/web/pages/sign-in.page.tsx";
const SERVER_FILES = [
  "src/app/db/connection.ts",
  "src/app/shared/index.ts",
  "src/app/shared/session.ts",
  "src/app/shared/user.model.ts",
];

let root = "";
let graph: FileGraph;
let plainGraph: FileGraph;
let scanned: ReturnType<typeof collectFiles>;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "grimoire-type-only-"));

  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${text}\n`);
  }

  scanned = collectFiles(root);
  const toGraph = (keepFlag: boolean): FileGraph =>
    fileGraph(
      scanned.map((file) => ({
        file: file.file,
        importedBy: file.importedBy,
        imports: file.imports.map((entry) => ({
          specifier: entry.specifier,
          file: entry.file,
          ...(keepFlag && entry.typeOnly === true ? { typeOnly: true } : {}),
        })),
      })),
    );

  graph = toGraph(true);
  plainGraph = toGraph(false);
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("page step files and type-only imports", () => {
  it("follows every import edge when no edge is marked type-only", () => {
    // Without type-only flags the walk from the page reaches the barrel, the model and the connection.
    expect(importClosure(plainGraph, [PAGE])).toEqual(
      [...SERVER_FILES, PAGE, "src/app/web/pages/sign-in-form.tsx"].sort(),
    );
  });

  it("leaves out server files reached only through type-only imports", () => {
    const form = scanned.find((file) => file.file === "src/app/web/pages/sign-in-form.tsx");

    expect(form?.imports.map((entry) => [entry.file, entry.typeOnly === true])).toEqual([
      ["src/app/shared/index.ts", true],
      ["src/app/shared/session.ts", true],
    ]);
    expect(importClosure(graph, [PAGE], { skipTypeOnly: true })).toEqual([
      "src/app/web/pages/sign-in-form.tsx",
      PAGE,
    ]);
  });

  it("follows type-only edges when asked to", () => {
    expect(importClosure(graph, [PAGE])).toEqual(
      [...SERVER_FILES, PAGE, "src/app/web/pages/sign-in-form.tsx"].sort(),
    );
  });

  it("marks `export type *` and type queries of `import()` as type-only", () => {
    const about = "src/app/web/pages/about.page.tsx";

    expect(
      scanned.find((file) => file.file === about)?.imports.map((entry) => entry.typeOnly),
    ).toEqual([true, true]);
    expect(importClosure(graph, [about], { skipTypeOnly: true })).toEqual([about]);
    expect(importClosure(graph, [about])).toContain("src/app/db/connection.ts");
  });
});
