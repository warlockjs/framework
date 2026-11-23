import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { E2EContext } from "@warlock.js/core/e2e";
import { solidPng } from "../shots/png.test-support";
import type { ShotCaptureIndex } from "../contracts/shots";
import { localizedPath } from "./languages";
import { resetShowsCache, shows } from "./shows";

const git = vi.hoisted(() => ({
  resolveBase: vi.fn(async () => "base"),
  changedFiles: vi.fn(async () => [] as { file: string; from: string | null }[]),
}));
const derived = vi.hoisted(() => ({ readDerived: vi.fn() }));

vi.mock("../git", () => git);
vi.mock("../workspace/derived", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workspace/derived")>()),
  readDerived: derived.readDerived,
}));

const roots: string[] = [];

function project(settings: string | null, flows: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-shows-"));

  roots.push(root);
  mkdirSync(path.join(root, "grimoire", "features", "contact", "flows"), { recursive: true });

  if (settings !== null) writeFileSync(path.join(root, "grimoire", "settings.md"), settings);

  for (const [name, text] of Object.entries(flows)) {
    writeFileSync(path.join(root, "grimoire", "features", "contact", "flows", `${name}.md`), text);
  }

  vi.spyOn(process, "cwd").mockReturnValue(root);

  return root;
}

function fakeContext(root: string) {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const page = {
    async setExtraHeaders(value: Record<string, string>) {
      headers.push(value);
    },
    async setViewport() {},
    async evaluate() {
      return { width: 1280, height: 800 };
    },
    async clearMocks() {},
    async screenshot(name: string) {
      const file = path.join(root, `${name}.tmp.png`);

      writeFileSync(file, solidPng(4, 4, [name.length, 0, 0, 255]));
      calls.push(name);

      return file;
    },
  };
  const context = {
    page,
    step: async <T>(_name: string, action: () => Promise<T>) => action(),
  } as unknown as E2EContext;

  return { context, calls, headers };
}

const index = (root: string): ShotCaptureIndex =>
  JSON.parse(readFileSync(path.join(root, "grimoire/screenshots/captured/index.json"), "utf8"));

const SETTINGS = (mode: string) => `---\nlanguages: [en, ar]\nscreenshots: ${mode}\n---\n`;
const REF = "contact/send-message AC-1";

beforeEach(() => {
  delete process.env.GRIMOIRE_SHOTS;
  resetShowsCache();
  git.changedFiles.mockReset();
  git.changedFiles.mockResolvedValue([]);
  derived.readDerived.mockReset();
  derived.readDerived.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();

  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shows()", () => {
  it("runs the scene once per language and saves one capture each", async () => {
    const root = project(SETTINGS("all"));
    const { context, headers } = fakeContext(root);
    const seen: string[] = [];

    await shows(context, REF, async ({ language, path: localized }) => {
      seen.push(`${language} ${localized("/")}`);
    });

    expect(seen).toEqual(["en /", "ar /"]);
    expect(headers).toEqual([{ locale: "en" }, { locale: "ar" }, {}]);

    const captures = index(root).captures;

    expect(captures.map((entry) => [entry.language, entry.outcome, entry.file])).toEqual([
      ["ar", "pass", "captured/contact/send-message/AC-1.ar.png"],
      ["en", "pass", "captured/contact/send-message/AC-1.en.png"],
    ]);
    expect(captures[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(captures[0]?.viewport).toEqual({ name: "default", width: 1280, height: 800 });
    expect(existsSync(path.join(root, "grimoire/screenshots/captured/contact/send-message/AC-1.en.png"))).toBe(true);
  });

  it("records a failing language, still runs the others, then throws", async () => {
    const root = project(SETTINGS("all"));
    const { context } = fakeContext(root);

    await expect(
      shows(context, REF, async ({ language }) => {
        if (language === "en") throw new Error("the button is missing");
      }),
    ).rejects.toThrow(/failed in 1 of 2 runs: en: the button is missing/);

    expect(index(root).captures.map((entry) => [entry.language, entry.outcome, entry.error])).toEqual([
      ["ar", "pass", null],
      ["en", "fail", "the button is missing"],
    ]);
  });

  it("keeps the entries of other criteria in the index", async () => {
    const root = project(SETTINGS("all"));
    const { context } = fakeContext(root);

    await shows(context, REF, async () => {});
    await shows(context, "contact/send-message AC-2", async () => {});

    expect(index(root).captures.map((entry) => `${entry.criterion}.${entry.language}`)).toEqual([
      "AC-1.ar",
      "AC-1.en",
      "AC-2.ar",
      "AC-2.en",
    ]);
  });

  it("runs nothing when the mode is off, and GRIMOIRE_SHOTS overrides the settings", async () => {
    const root = project(SETTINGS("off"));
    const { context, calls } = fakeContext(root);
    let ran = 0;

    await shows(context, REF, async () => void ran++);
    expect(ran).toBe(0);
    expect(calls).toEqual([]);

    process.env.GRIMOIRE_SHOTS = "all";
    await shows(context, REF, async () => void ran++);
    expect(ran).toBe(2);
  });

  it("skips a flow that opted out", async () => {
    const root = project(SETTINGS("all"), {
      "send-message": "---\nid: send-message\nscreenshots: false\n---\n# Send\n",
    });
    const { context } = fakeContext(root);
    let ran = 0;

    await shows(context, REF, async () => void ran++);

    expect(ran).toBe(0);
  });

  it("in changed mode runs only touched features", async () => {
    const root = project(SETTINGS("changed"));
    const { context } = fakeContext(root);
    let ran = 0;

    derived.readDerived.mockResolvedValue({
      snapshot: { ownership: { files: { "src/app/shop/a.ts": { owner: "shop" } }, features: {} } },
    });
    git.changedFiles.mockResolvedValue([{ file: "src/app/shop/a.ts", from: null }]);

    await shows(context, REF, async () => void ran++);
    expect(ran).toBe(0);

    resetShowsCache();
    git.changedFiles.mockResolvedValue([{ file: "grimoire/features/contact/flows/send-message.md", from: null }]);

    await shows(context, REF, async () => void ran++);
    expect(ran).toBe(2);
    void root;
  });

  it("in changed mode captures everything when git cannot answer", async () => {
    const root = project(SETTINGS("changed"));
    const { context } = fakeContext(root);
    let ran = 0;

    derived.readDerived.mockResolvedValue({ snapshot: { ownership: { files: {}, features: {} } } });
    git.changedFiles.mockRejectedValue(new Error("not a git repository"));

    await shows(context, REF, async () => void ran++);

    expect(ran).toBe(2);
    void root;
  });

  it("refuses a ref that is not <feature>/<flow> AC-<n>", async () => {
    const root = project(null);
    const { context } = fakeContext(root);

    await expect(shows(context, "contact AC-1", async () => {})).rejects.toThrow(/not "<feature>\/<flow> AC-<n>"/);
  });
});

describe("localizedPath", () => {
  it("follows the locale routing strategy", () => {
    const base = { defaultLanguage: "en" };

    expect(localizedPath("/", "ar", { ...base, strategy: "none" })).toBe("/");
    expect(localizedPath("/", "ar", { ...base, strategy: "prefix" })).toBe("/ar");
    expect(localizedPath("/about", "en", { ...base, strategy: "prefix" })).toBe("/en/about");
    expect(localizedPath("/about", "en", { ...base, strategy: "prefix-except-default" })).toBe("/about");
    expect(localizedPath("about", "ar", { ...base, strategy: "prefix-except-default" })).toBe("/ar/about");
  });
});
